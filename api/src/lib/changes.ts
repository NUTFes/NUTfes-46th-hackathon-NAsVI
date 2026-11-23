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
  env: Env, stmts: D1PreparedStatement[], change: { type: ChangeType; payload: unknown },
  ctx?: { waitUntil(p: Promise<unknown>): void },
): Promise<{ changeId: number }> {
  const createdAt = nowIso(env);
  const insert = env.DB.prepare('INSERT INTO changes (type, payload, created_at) VALUES (?, ?, ?)')
    .bind(change.type, JSON.stringify(change.payload), createdAt);
  const results = await env.DB.batch([...stmts, insert]);
  const changeId = results[results.length - 1].meta.last_row_id;
  const pending = publish(env, { id: changeId, ...change, createdAt });
  if (ctx) ctx.waitUntil(pending);
  else await pending;
  return { changeId };
}
