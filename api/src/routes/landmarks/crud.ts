import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';
import { rateLimit } from '../../middleware/ratelimit';

export function register(app: Hono<AppEnv>) {
  app.get('/landmarks', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), c => problem(c, 501, 'internal_error', 'GET /landmarks は未実装です'));
  app.post('/landmarks', requireOperator, c => problem(c, 501, 'internal_error', 'POST /landmarks は未実装です'));
  app.patch('/landmarks/:landmarkId', requireOperator, c => problem(c, 501, 'internal_error', 'PATCH /landmarks/:landmarkId は未実装です'));
  app.delete('/landmarks/:landmarkId', requireOperator, c => problem(c, 501, 'internal_error', 'DELETE /landmarks/:landmarkId は未実装です'));
}
