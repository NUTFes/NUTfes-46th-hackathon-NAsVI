// Best-effort fixed-window limits: counters live only in this isolate's memory
// and are neither shared across isolates nor retained when an isolate restarts.
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { problem } from '../lib/errors';

export interface RateLimitOptions { key: string; limit: number; windowSec: number }

const MAX_BODY_BYTES = 1048576;
const CLEANUP_INTERVAL_MS = 60_000;
const counters = new Map<string, { count: number; expiresAt: number }>();
let nextCleanupAt = 0;

export function rateLimit({ key, limit, windowSec }: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (Number(c.req.header('content-length')) > MAX_BODY_BYTES) {
        return problem(c, 413, 'payload_too_large', '本文は 1 MB 以下にしてください');
      }
      // Hono caches this buffer, so downstream handlers can still read the body.
      if ((await c.req.arrayBuffer()).byteLength > MAX_BODY_BYTES) {
        return problem(c, 413, 'payload_too_large', '本文は 1 MB 以下にしてください');
      }
    }

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
      c.req.header('cf-connecting-ip') ?? 'unknown',
    ));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const counterKey = `${key}:${hash}`;
    const now = Date.now();

    // Sweep on requests, at most once per minute; no isolate-lifetime timers.
    if (now >= nextCleanupAt) {
      for (const [entryKey, entry] of counters) {
        if (entry.expiresAt <= now) counters.delete(entryKey);
      }
      nextCleanupAt = now + CLEANUP_INTERVAL_MS;
    }

    let counter = counters.get(counterKey);
    if (!counter || counter.expiresAt <= now) {
      counter = { count: 0, expiresAt: now + windowSec * 1000 };
      counters.set(counterKey, counter);
    }
    // Keep the check and increment synchronous so concurrent requests share the cap.
    if (counter.count >= limit) {
      c.header('Retry-After', String(Math.ceil((counter.expiresAt - now) / 1000)));
      return problem(c, 429, 'too_many_requests', 'しばらく待ってからもう一度お試しください');
    }
    counter.count++;
    await next();
  });
}
