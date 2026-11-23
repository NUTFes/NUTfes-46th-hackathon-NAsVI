import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';

export function register(app: Hono<AppEnv>) {
  app.put('/landmarks/:landmarkId/floors/:floor/plan', requireOperator, c => problem(c, 501, 'internal_error', 'PUT /landmarks/:landmarkId/floors/:floor/plan は未実装です'));
  app.delete('/landmarks/:landmarkId/floors/:floor/plan', requireOperator, c => problem(c, 501, 'internal_error', 'DELETE /landmarks/:landmarkId/floors/:floor/plan は未実装です'));
}
