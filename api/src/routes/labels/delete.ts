import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';

export function register(app: Hono<AppEnv>) {
  app.delete('/labels/:labelId', requireOperator, c => problem(c, 501, 'internal_error', 'DELETE /labels/:labelId は未実装です'));
}
