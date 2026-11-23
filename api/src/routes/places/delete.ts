import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';

export function register(app: Hono<AppEnv>) {
  app.delete('/places/:placeId', requireOperator, c => problem(c, 501, 'internal_error', 'DELETE /places/:placeId は未実装です'));
}
