import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { rateLimit } from '../../middleware/ratelimit';

export function register(app: Hono<AppEnv>) {
  app.post('/stamps', rateLimit({ key: 'stamp-press', limit: 5, windowSec: 60 }), c => problem(c, 501, 'internal_error', 'POST /stamps は未実装です'));
}
