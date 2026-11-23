import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppEnv } from '../src/env';
import { bodyLimit } from '../src/middleware/bodylimit';
import { operatorEnv, request, requestWithEnv } from './helpers';

const MAX_BODY_BYTES = 1048576;
const tooLarge = { code: 'payload_too_large', message: '本文は 1 MB 以下にしてください' };

function testApp() {
  const app = new Hono<AppEnv>();
  app.use('*', bodyLimit);
  app.all('*', async c => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return c.text('ok');
    const bodyUsed = c.req.raw.bodyUsed;
    return c.json({ bodyUsed, bytes: (await c.req.arrayBuffer()).byteLength });
  });
  return app;
}

function streamBody(bytes: number) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

async function expectTooLarge(response: Response) {
  expect(response.status).toBe(413);
  expect(response.headers.get('Content-Type')).toBe('application/problem+json');
  expect(await response.json()).toEqual(tooLarge);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['buffer', 'stream'])('%s 本文が 1 MB ちょうどなら通り、元の本文は未消費のまま後続で読める', async source => {
  const response = await testApp().request('/test', {
    method: 'POST', body: source === 'stream' ? streamBody(MAX_BODY_BYTES) : new Uint8Array(MAX_BODY_BYTES),
  }, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ bodyUsed: false, bytes: MAX_BODY_BYTES });
});

it('本文が 1 バイト超過すると 413 problem+json を返す', async () => {
  await expectTooLarge(await testApp().request('/test', {
    method: 'POST', body: new Uint8Array(MAX_BODY_BYTES + 1),
  }, env));
});

it('Content-Length が上限超過なら本文を読まず clone もしない', async () => {
  const req = new Request('http://local/test', {
    method: 'POST', headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
  });
  const clone = vi.spyOn(req, 'clone');
  const arrayBuffer = vi.spyOn(req, 'arrayBuffer');
  await expectTooLarge(await testApp().fetch(req, env));
  expect(clone).not.toHaveBeenCalled();
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(req.bodyUsed).toBe(false);
});

it.each([undefined, 'invalid', '-1', 'Infinity', '0', '1', String(MAX_BODY_BYTES)])(
  'Content-Length=%s でもストリーム本文の超過を検出する', async contentLength => {
    const headers = new Headers();
    if (contentLength !== undefined) headers.set('Content-Length', contentLength);
    const req = new Request('http://local/test', {
      method: 'POST', headers, body: streamBody(MAX_BODY_BYTES + 1),
    });
    if (contentLength === undefined) expect(req.headers.has('Content-Length')).toBe(false);
    await expectTooLarge(await testApp().fetch(req, env));
    expect(req.bodyUsed).toBe(false);
  },
);

it('大きなチャンクでも検査で読み取るのは上限 + 1 バイトまでにする', async () => {
  const read = vi.spyOn(ReadableStreamBYOBReader.prototype, 'read');
  const req = new Request('http://local/test', {
    method: 'POST', body: streamBody(MAX_BODY_BYTES * 4),
  });
  await expectTooLarge(await testApp().fetch(req, env));
  const chunks = await Promise.all(read.mock.results.map(result => result.value));
  expect(chunks.reduce((bytes, chunk) => bytes + (chunk.value?.byteLength ?? 0), 0)).toBe(MAX_BODY_BYTES + 1);
  expect(req.bodyUsed).toBe(false);
  await req.body!.cancel();
});

it('終端のないストリームも全体を読み切ろうとせず拒否する', async () => {
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    controller.enqueue(new Uint8Array(64 * 1024));
  });
  const req = new Request('http://local/test', {
    method: 'POST', body: new ReadableStream<Uint8Array>({ pull }),
  });
  await expectTooLarge(await testApp().fetch(req, env));
  // Allow tee prefetching, but never drain an unbounded source.
  expect(pull.mock.calls.length).toBeLessThan(24);
  expect(req.bodyUsed).toBe(false);
  await req.body!.cancel();
});

it('UTF-8 の文字数ではなくバイト数を検査する', async () => {
  await expectTooLarge(await testApp().request('/test', {
    method: 'POST', body: 'あ'.repeat(Math.ceil(MAX_BODY_BYTES / 3)),
  }, env));
});

it.each(['GET', 'HEAD'])('%s は Content-Length が超過していても検査しない', async method => {
  const req = new Request('http://local/test', {
    method, headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
  });
  const clone = vi.spyOn(req, 'clone');
  expect((await testApp().fetch(req, env)).status).toBe(200);
  expect(clone).not.toHaveBeenCalled();
});

it('空の POST も通す', async () => {
  const response = await testApp().request('/test', { method: 'POST' }, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ bodyUsed: false, bytes: 0 });
});

it('後続ハンドラーで元の JSON 本文を読める', async () => {
  const app = new Hono<AppEnv>();
  app.use('*', bodyLimit);
  app.post('/test', async c => c.json(await c.req.json()));
  const response = await app.request('/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"value":"本文"}',
  }, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ value: '本文' });
});

it.each([
  ['POST', '/api/places'],
  ['PATCH', '/api/places/x'],
  ['DELETE', '/api/places/x'],
  ['POST', '/api/labels'],
  ['DELETE', '/api/labels/x'],
  ['PUT', '/api/places/x/labels/x'],
  ['DELETE', '/api/places/x/labels/x'],
  ['POST', '/api/landmarks'],
  ['PATCH', '/api/landmarks/x'],
  ['DELETE', '/api/landmarks/x'],
  ['POST', '/api/landmarks/x/footprint'],
  ['PUT', '/api/landmarks/x/floors/1'],
  ['PUT', '/api/landmarks/x/floors/1/plan'],
  ['DELETE', '/api/landmarks/x/floors/1/plan'],
  ['POST', '/api/stamps'],
  ['DELETE', '/api/stamps/x'],
  ['POST', '/api/dev/emit'],
])('実アプリの $0 $1 にも本文制限が適用される', async (method, path) => {
  await expectTooLarge(await requestWithEnv(path, {
    method, body: streamBody(MAX_BODY_BYTES + 1),
  }, operatorEnv()));
});

it('ローカルの SELF 経由でも運営 API に本文制限が適用される', async () => {
  await expectTooLarge(await request('/api/places', {
    method: 'POST', body: new Uint8Array(MAX_BODY_BYTES + 1),
  }));
});
