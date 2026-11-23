import type { Hono } from 'hono';
import { z } from 'zod';
import { CLOSING_TIME, CONGESTION_TTL_MIN, VENUE_BOUNDS } from '../../config';
import type { AppEnv } from '../../env';
import { getHub, type ChangeEvent } from '../../lib/changes';
import { problem } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso } from '../../lib/time';
import { rateLimit } from '../../middleware/ratelimit';
import type { components } from '../../schema';

const stampInput = z.object({
  kind: z.enum(['congestion-1', 'congestion-2', 'congestion-3', 'congestion-4', 'congestion-5', 'fun', 'food', 'good']),
  at: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
});

interface StoredChange { id: number; payload: string; created_at: string }

function expiresAt(kind: components['schemas']['StampKind'], pressedAt: string): string {
  if (kind.startsWith('congestion-')) {
    return new Date(Date.parse(pressedAt) + CONGESTION_TTL_MIN * 60_000).toISOString();
  }
  // 閉場後に押した感想は expiresAt が pressedAt より前になり、即期限切れになる(仕様どおり。テストで固定)。
  const venueDate = new Date(Date.parse(pressedAt) + 9 * 60 * 60_000).toISOString().slice(0, 10);
  return new Date(`${venueDate}T${CLOSING_TIME}:00+09:00`).toISOString();
}

export function register(app: Hono<AppEnv>) {
  app.post('/stamps', rateLimit({ key: 'stamp-press', limit: 5, windowSec: 60 }), async c => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problem(c, 400, 'invalid_input', 'JSON の本文を送ってください');
    }
    const parsed = stampInput.safeParse(body);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return problem(c, 400, 'invalid_input', 'スタンプの種類と地点を正しく指定してください', typeof field === 'string' ? field : undefined);
    }
    const { kind, at } = parsed.data;
    if (at.lat < VENUE_BOUNDS.south || at.lat > VENUE_BOUNDS.north || at.lng < VENUE_BOUNDS.west || at.lng > VENUE_BOUNDS.east) {
      return problem(c, 400, 'out_of_venue', '会場の外ではスタンプを押せません', 'at');
    }

    try {
      const id = newId();
      const pressedAt = new Date(nowIso(c.env)).toISOString();
      const proof = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof));
      const proofHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');

      // commitWithChange serializes its payload before writing. Build this payload
      // from the stored row in SQL, keeping the stamp and history in one batch.
      const results = await c.env.DB.batch<StoredChange>([
        c.env.DB.prepare(`INSERT INTO stamps (id, kind, lat, lng, pressed_at, expires_at, proof_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, kind, at.lat, at.lng, pressedAt, expiresAt(kind, pressedAt), proofHash),
        c.env.DB.prepare(`INSERT INTO changes (type, payload, created_at)
          SELECT 'stampPressed', json_object(
            'id', id, 'kind', kind, 'at', json_object('lat', lat, 'lng', lng),
            'pressedAt', pressed_at, 'expiresAt', expires_at
          ), ? FROM stamps WHERE id = ?`).bind(pressedAt, id),
        c.env.DB.prepare('SELECT id, payload, created_at FROM changes WHERE id = last_insert_rowid()'),
      ]);
      const stored = results[2].results[0];
      if (!stored) throw new Error('Stamp change was not stored');
      const stamp = JSON.parse(stored.payload) as components['schemas']['Stamp'];
      const change: ChangeEvent = { id: stored.id, type: 'stampPressed', payload: stamp, createdAt: stored.created_at };
      const publishing = (async () => {
        try {
          const response = await getHub(c.env).fetch('http://hub/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(change),
          });
          await response.body?.cancel();
        } catch {
          // D1 is authoritative; reconnecting clients can replay this change.
        }
      })();
      // Do not delay the response on the Hub; fall back to awaiting when no execution context exists.
      let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
      try { ctx = c.executionCtx; } catch { ctx = undefined; }
      if (ctx) ctx.waitUntil(publishing);
      else await publishing;
      const pressed: components['schemas']['PressedStamp'] = { ...stamp, proof };
      return c.json(pressed, 201);
    } catch {
      // Do not log request data or database errors containing stamp locations.
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
