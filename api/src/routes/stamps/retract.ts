import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { rateLimit } from '../../middleware/ratelimit';

export function register(app: Hono<AppEnv>) {
  app.delete('/stamps/:stampId', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), c => problem(c, 501, 'internal_error', 'DELETE /stamps/:stampId は未実装です'));
}
