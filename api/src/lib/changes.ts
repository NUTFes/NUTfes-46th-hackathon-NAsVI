import type { Env } from '../env';
import { nowIso } from './time';

export type ChangeType = 'stampPressed' | 'stampRetracted' | 'placeAdded' | 'placeUpdated' | 'placeRemoved' | 'appVersionChanged';
export interface ChangeEvent { id: number; type: ChangeType; payload: unknown; createdAt: string }

export function getHub(env: Env) {
  return env.HUB.get(env.HUB.idFromName('main'));
}

async function publish(env: Env, event: ChangeEvent): Promise<void> {
  try {
    const response = await getHub(env).fetch('http://hub/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    await response.body?.cancel();
  } catch {
    // D1 is authoritative. Reconnecting clients replay the committed change.
  }
}

export async function commitWithChange(
  env: Env, stmts: D1PreparedStatement[],
  change: { type: ChangeType; payload: unknown } | { type: ChangeType; payloadSql: { sql: string; params: unknown[] } },
  ctx?: { waitUntil(p: Promise<unknown>): void },
): Promise<{ changeId: number; payload: unknown }> {
  const createdAt = nowIso(env);
  const insert = 'payloadSql' in change
    ? env.DB.prepare(`INSERT INTO changes (type, payload, created_at) SELECT ?, (${change.payloadSql.sql}), ?`)
      .bind(change.type, ...change.payloadSql.params, createdAt)
    : env.DB.prepare('INSERT INTO changes (type, payload, created_at) VALUES (?, ?, ?)')
      .bind(change.type, JSON.stringify(change.payload), createdAt);
  const results = await env.DB.batch([...stmts, insert]);
  const changeId = results[results.length - 1].meta.last_row_id;
  const payload: unknown = 'payloadSql' in change
    ? JSON.parse((await env.DB.prepare('SELECT payload FROM changes WHERE id = ?').bind(changeId).first<string>('payload'))!)
    : change.payload;
  const pending = publish(env, { id: changeId, type: change.type, payload, createdAt });
  if (ctx) ctx.waitUntil(pending);
  else await pending;
  return { changeId, payload };
}
