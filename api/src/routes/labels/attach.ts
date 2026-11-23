import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';

export function register(app: Hono<AppEnv>) {
  app.put('/places/:placeId/labels/:labelId', requireOperator, c => problem(c, 501, 'internal_error', 'PUT /places/:placeId/labels/:labelId は未実装です'));
  app.delete('/places/:placeId/labels/:labelId', requireOperator, c => problem(c, 501, 'internal_error', 'DELETE /places/:placeId/labels/:labelId は未実装です'));
}
