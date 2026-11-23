import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

export interface RateLimitOptions { key: string; limit: number; windowSec: number }

// Enforcement, including request body limits, is implemented by A-13.
export function rateLimit(_options: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (_c, next) => { await next(); });
}
