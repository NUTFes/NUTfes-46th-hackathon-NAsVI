import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { problem } from '../lib/errors';

const MAX_BODY_BYTES = 1048576;

export const bodyLimit = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();

  const contentLength = c.req.header('content-length');
  if (contentLength !== undefined && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
    return problem(c, 413, 'payload_too_large', '本文は 1 MB 以下にしてください');
  }

  // Check actual bytes even when a smaller Content-Length was supplied.
  // Read only the clone so downstream handlers retain the untouched request.
  const body = c.req.raw.clone().body;
  if (body) {
    let reader: ReadableStreamBYOBReader;
    try {
      reader = body.getReader({ mode: 'byob' });
    } catch {
      // JS-created streams may need a native byte stream for bounded reads.
      reader = body.pipeThrough(new IdentityTransformStream()).getReader({ mode: 'byob' });
    }
    let bytes = 0;
    try {
      while (bytes <= MAX_BODY_BYTES) {
        const buffer = new Uint8Array(Math.min(64 * 1024, MAX_BODY_BYTES + 1 - bytes));
        const { done, value } = await reader.read(buffer);
        bytes += value?.byteLength ?? 0;
        if (bytes > MAX_BODY_BYTES) {
          return problem(c, 413, 'payload_too_large', '本文は 1 MB 以下にしてください');
        }
        if (done) break;
      }
    } finally {
      // A tee's cancellation may wait for the original body; do not await it.
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  await next();
});
