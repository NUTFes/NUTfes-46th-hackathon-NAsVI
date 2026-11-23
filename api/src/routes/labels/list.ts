import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import type { components } from '../../schema';
import { all } from '../../lib/db';
import { problem } from '../../lib/errors';
import { rateLimit } from '../../middleware/ratelimit';

export function register(app: Hono<AppEnv>) {
  app.get('/labels', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), async c => {
    try {
      const items = await all<components['schemas']['Label']>(c.env.DB, 'SELECT id, title FROM labels');
      return c.json({ items });
    } catch {
      return problem(c, 500, 'internal_error', '種類の一覧を取得できませんでした');
    }
  });
}
