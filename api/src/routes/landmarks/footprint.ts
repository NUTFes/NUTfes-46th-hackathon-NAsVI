import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';

export function register(app: Hono<AppEnv>) {
  app.post('/landmarks/:landmarkId/footprint', requireOperator, c => problem(c, 501, 'internal_error', 'POST /landmarks/:landmarkId/footprint は未実装です'));
}
