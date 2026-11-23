import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import type { components } from '../../schema';
import { prepare } from '../../lib/db';
import { problem } from '../../lib/errors';
import { nowIso } from '../../lib/time';
import { rateLimit } from '../../middleware/ratelimit';

interface StampRow {
  id: string;
  kind: components['schemas']['StampKind'];
  lat: number;
  lng: number;
  pressed_at: string;
  expires_at: string;
}

export function register(app: Hono<AppEnv>) {
  app.get('/stamps', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), async c => {
    try {
      // Read both queries in one transaction so the cursor describes this list.
      const [stamps, cursor] = await c.env.DB.batch<StampRow | { cursor: string }>([
        prepare(c.env.DB, `SELECT id, kind, lat, lng, pressed_at, expires_at
          FROM stamps WHERE expires_at > ? ORDER BY pressed_at, id`, [nowIso(c.env)]),
        prepare(c.env.DB, 'SELECT CAST(COALESCE(MAX(id), 0) AS TEXT) AS cursor FROM changes'),
      ]);
      const body: components['schemas']['StampList'] = {
        items: (stamps.results as StampRow[]).map(row => ({
          id: row.id,
          kind: row.kind,
          at: { lat: row.lat, lng: row.lng },
          pressedAt: row.pressed_at,
          expiresAt: row.expires_at,
        })),
        cursor: (cursor.results[0] as { cursor: string }).cursor,
      };
      return c.json(body);
    } catch {
      return problem(c, 500, 'internal_error', 'スタンプの一覧を取得できませんでした');
    }
  });
}
