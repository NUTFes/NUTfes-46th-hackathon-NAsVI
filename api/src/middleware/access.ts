import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { problem } from '../lib/errors';

// JWT verification is implemented by A-12. Default to denying operator access.
export const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.ACCESS_BYPASS !== 'true') return problem(c, 401, 'unauthorized', '運営としてログインしてください');
  c.set('actor', { email: 'operator@example.com' });
  await next();
});
