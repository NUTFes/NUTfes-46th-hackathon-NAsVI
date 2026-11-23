import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppEnv } from '../src/env';
import { rateLimit, type RateLimitOptions } from '../src/middleware/ratelimit';

const MAX_BODY_BYTES = 1048576;
const start = Date.parse('2026-11-24T01:00:00.000Z');
let key: string;

function testApp(options: Partial<RateLimitOptions> = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', rateLimit({ key, limit: 2, windowSec: 60, ...options }));
  app.all('*', async c => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return c.text('ok');
    return c.json({ bytes: (await c.req.arrayBuffer()).byteLength });
  });
  return app;
}

function request(app: Hono<AppEnv>, ip = '192.0.2.1', init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', ip);
  return app.request('/test', { ...init, headers }, env);
}

beforeEach(() => {
  key = `ratelimit-test:${crypto.randomUUID()}`;
  vi.spyOn(Date, 'now').mockReturnValue(start);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('上限ちょうどまではルートに到達できる', async () => {
  const app = testApp();
  for (let i = 0; i < 2; i++) {
    const response = await request(app);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.has('Retry-After')).toBe(false);
  }
});

it('上限を超えると 429 problem+json と残り秒数の Retry-After を返す', async () => {
  const app = testApp({ limit: 1 });
  expect((await request(app)).status).toBe(200);
  vi.mocked(Date.now).mockReturnValue(start + 1250);
  const response = await request(app);
  expect(response.status).toBe(429);
  expect(response.headers.get('Content-Type')).toBe('application/problem+json');
  expect(response.headers.get('Retry-After')).toBe('59');
  expect(await response.json()).toEqual({ code: 'too_many_requests', message: expect.any(String) });
});

it('拒否を繰り返しても窓を延長せず、期限ちょうどで上限まで回復する', async () => {
  const app = testApp({ windowSec: 10 });
  await request(app);
  await request(app);
  vi.mocked(Date.now).mockReturnValue(start + 9999);
  const blocked = await request(app);
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get('Retry-After')).toBe('1');
  vi.mocked(Date.now).mockReturnValue(start + 10_000);
  expect((await request(app)).status).toBe(200);
  expect((await request(app)).status).toBe(200);
  expect((await request(app)).status).toBe(429);
});

it('通信元 IP ごとに独立してカウントする', async () => {
  const app = testApp({ limit: 1 });
  expect((await request(app, '192.0.2.1')).status).toBe(200);
  expect((await request(app, '192.0.2.1')).status).toBe(429);
  expect((await request(app, '192.0.2.2')).status).toBe(200);
  expect((await request(app, '192.0.2.2')).status).toBe(429);
});

it('同じ通信元でも key ごとに独立してカウントする', async () => {
  const read = testApp({ key: `${key}:read`, limit: 1 });
  const stamp = testApp({ key: `${key}:stamp`, limit: 1 });
  expect((await request(read)).status).toBe(200);
  expect((await request(read)).status).toBe(429);
  expect((await request(stamp)).status).toBe(200);
  expect((await request(stamp)).status).toBe(429);
});

it('同じ key の別ミドルウェア・別ルートでもカウンタを共有する', async () => {
  const first = testApp({ limit: 1 });
  const second = testApp({ limit: 1 });
  expect((await request(first)).status).toBe(200);
  expect((await second.request('/other', { headers: { 'cf-connecting-ip': '192.0.2.1' } }, env)).status).toBe(429);
});

it('ヘッダのない通信元は固定のフォールバックでカウントする', async () => {
  const app = testApp({ limit: 1 });
  expect((await app.request('/first', {}, env)).status).toBe(200);
  expect((await app.request('/second', { headers: { 'x-forwarded-for': '192.0.2.2' } }, env)).status).toBe(429);
  expect((await request(app)).status).toBe(200);
});

it('並行したリクエストでも上限を超えて通さない', async () => {
  const app = testApp({ limit: 5 });
  const responses = await Promise.all(Array.from({ length: 12 }, () => request(app)));
  expect(responses.filter(response => response.status === 200)).toHaveLength(5);
  expect(responses.filter(response => response.status === 429)).toHaveLength(7);
});

it('Content-Length が 1 MB を超えたら本文を読まずに 413 を返す', async () => {
  const app = testApp();
  const req = new Request('http://local/test', {
    method: 'POST', headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
  });
  const readBody = vi.spyOn(req, 'arrayBuffer');
  const response = await app.fetch(req, env);
  expect(response.status).toBe(413);
  expect(response.headers.get('Content-Type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'payload_too_large', message: expect.any(String) });
  expect(readBody).not.toHaveBeenCalled();
});

it.each([undefined, '0', '1', String(MAX_BODY_BYTES)])('Content-Length=%s でも実際の本文が 1 MB 超なら 413 を返す', async contentLength => {
  const app = testApp();
  const headers = new Headers();
  if (contentLength !== undefined) headers.set('Content-Length', contentLength);
  // A stream avoids an automatically inferred Content-Length.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
      controller.close();
    },
  });
  const response = await request(app, '192.0.2.1', { method: 'POST', headers, body });
  expect(response.status).toBe(413);
  expect(response.headers.get('Content-Type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'payload_too_large', message: expect.any(String) });
});

it('文字数ではなく UTF-8 のバイト数で本文を制限する', async () => {
  const app = testApp();
  const body = 'あ'.repeat(Math.ceil(MAX_BODY_BYTES / 3));
  expect(body.length).toBeLessThan(MAX_BODY_BYTES);
  const response = await request(app, '192.0.2.1', { method: 'POST', body });
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ code: 'payload_too_large' });
});

it('本文が 1 MB ちょうどなら通し、ルートでもキャッシュされた本文を読める', async () => {
  const response = await request(testApp(), '192.0.2.1', {
    method: 'POST', body: new Uint8Array(MAX_BODY_BYTES),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ bytes: MAX_BODY_BYTES });
});

it('ミドルウェアが本文を読んだ後でもルートで JSON を読める', async () => {
  const app = new Hono<AppEnv>();
  app.post('/test', rateLimit({ key, limit: 1, windowSec: 60 }), async c => c.json(await c.req.json()));
  const response = await request(app, '192.0.2.1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"value":"本文"}',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ value: '本文' });
});

it.each(['GET', 'HEAD'])('%s は本文を確認しない', async method => {
  const app = testApp();
  const req = new Request('http://local/test', {
    method, headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
  });
  const readBody = vi.spyOn(req, 'arrayBuffer');
  expect((await app.fetch(req, env)).status).toBe(200);
  expect(readBody).not.toHaveBeenCalled();
});
