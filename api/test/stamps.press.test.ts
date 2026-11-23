import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as config from '../src/config';
import type { AppEnv, Env } from '../src/env';
import type { ChangeEvent } from '../src/lib/changes';
import { problem } from '../src/lib/errors';
import * as rateLimits from '../src/middleware/ratelimit';
import { register } from '../src/routes/stamps/press';
import type { components } from '../src/schema';
import { migrateTestDb, requestWithEnv } from './helpers';

type PressedStamp = components['schemas']['PressedStamp'];
const now = '2026-11-28T02:05:06.789Z';
const at = { lat: 37.4252, lng: 138.7788 };
const input = { kind: 'congestion-3', at };
const savedConfig = {
  CONGESTION_TTL_MIN: config.CONGESTION_TTL_MIN,
  CLOSING_TIME: config.CLOSING_TIME,
  VENUE_BOUNDS: { ...config.VENUE_BOUNDS },
};
const publish = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
const externalFetch = vi.fn(() => Promise.reject(new Error('External network is disabled in tests')));
let bindings: Env;
// Keep advancing across tests because rate-limit counters outlive beforeEach.
// Reserve 192.0.2.1 for the logging test and 203.0.113.254 for enforcement.
let requestNumber = 0;

function pressHeaders() {
  return { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${++requestNumber}` };
}

beforeAll(async () => {
  vi.stubGlobal('fetch', externalFetch);
  await migrateTestDb();
});
beforeEach(async () => {
  config.configureConfig(savedConfig);
  publish.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  externalFetch.mockClear();
  bindings = {
    ...env, NOW: now, ACCESS_BYPASS: undefined,
    HUB: {
      idFromName: vi.fn(() => 'main-id'),
      get: vi.fn(() => ({ fetch: publish })),
    } as unknown as Env['HUB'],
  };
  await env.DB.batch([
    env.DB.prepare('DROP TRIGGER IF EXISTS press_test_rewrite'),
    env.DB.prepare('DROP TRIGGER IF EXISTS press_test_reject_change'),
    env.DB.prepare('DELETE FROM stamps'),
    env.DB.prepare('DELETE FROM changes'),
  ]);
});
afterEach(() => {
  config.configureConfig(savedConfig);
  expect(externalFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
afterAll(() => { vi.unstubAllGlobals(); });

function press(body: unknown = input, overrides: Partial<Env> = {}): Promise<Response> {
  return requestWithEnv('/api/stamps', {
    method: 'POST', headers: pressHeaders(), body: JSON.stringify(body),
  }, { ...bindings, ...overrides });
}

async function pressed(body: unknown = input, overrides: Partial<Env> = {}): Promise<PressedStamp> {
  const response = await press(body, overrides);
  expect(response.status).toBe(201);
  expect(response.headers.get('content-type')).toContain('application/json');
  return await response.json() as PressedStamp;
}

async function expectNoWrites(): Promise<void> {
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM stamps').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
  expect(publish).not.toHaveBeenCalled();
}

async function changeRow() {
  return env.DB.prepare('SELECT id, type, payload, created_at FROM changes').first<{
    id: number; type: string; payload: string; created_at: string;
  }>();
}

it('認証なしで 201 と proof 付きの PressedStamp を返す', async () => {
  const stamp = await pressed();
  expect(stamp).toEqual({
    id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    kind: input.kind, at, pressedAt: now, expiresAt: '2026-11-28T02:35:06.789Z',
    proof: expect.any(String),
  });
});

it('毎分5件の rateLimit を適用し、ミドルウェアが拒否したら保存・配信しない', async () => {
  // A-13 owns enforcement. Substitute a rejecting middleware to check delegation.
  const limit = vi.spyOn(rateLimits, 'rateLimit').mockReturnValueOnce(async c =>
    problem(c, 429, 'too_many_requests', 'しばらく待ってから押してください'));
  const app = new Hono<AppEnv>().basePath('/api');
  register(app);
  const response = await app.request('/api/stamps', {
    method: 'POST', headers: pressHeaders(), body: JSON.stringify(input),
  }, bindings);
  expect(limit).toHaveBeenCalledWith({ key: 'stamp-press', limit: 5, windowSec: 60 });
  expect(response.status).toBe(429);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'too_many_requests', message: expect.any(String) });
  await expectNoWrites();
});

it('同じ通信元から毎分5回までは201、6回目は Retry-After 付きの429を返す', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.254' },
    body: JSON.stringify(input),
  };
  for (let i = 0; i < 5; i++) {
    expect((await requestWithEnv('/api/stamps', init, bindings)).status).toBe(201);
  }
  const response = await requestWithEnv('/api/stamps', init, bindings);
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({ code: 'too_many_requests' });
  expect(response.headers.get('Retry-After')).toBe('60');
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM stamps').first('n')).toBe(5);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(5);
  expect(publish).toHaveBeenCalledTimes(5);
});

it('proof は毎回異なる32バイトのランダム値を表す正規の base64url', async () => {
  const first = await pressed();
  const second = await pressed();
  expect(second.id).not.toBe(first.id);
  expect(second.proof).not.toBe(first.proof);
  for (const stamp of [first, second]) {
    expect(stamp.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const decoded = atob(stamp.proof.replace(/-/g, '+').replace(/_/g, '/') + '=');
    expect(decoded.length).toBe(32);
    expect(btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')).toBe(stamp.proof);
  }
});

it('D1 には proof そのものを保存せず、その SHA-256 ハッシュだけを保存する', async () => {
  const stamp = await pressed();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stamp.proof));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const row = await env.DB.prepare('SELECT * FROM stamps WHERE id = ?').bind(stamp.id).first();
  expect(row).toEqual({
    id: stamp.id, kind: stamp.kind, lat: at.lat, lng: at.lng,
    pressed_at: stamp.pressedAt, expires_at: stamp.expiresAt, proof_hash: hash,
  });
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(hash).not.toBe(stamp.proof);
  const storedChanges = await env.DB.prepare('SELECT * FROM changes').all();
  expect(JSON.stringify([row, storedChanges.results])).not.toContain(stamp.proof);
});

it('stampPressed を保存して main Hub に配信し、履歴・配信のどちらにも proof を含めない', async () => {
  const { proof, ...stamp } = await pressed();
  const stored = await changeRow();
  expect(stored).toEqual({ id: expect.any(Number), type: 'stampPressed', payload: expect.any(String), created_at: now });
  expect(JSON.parse(stored!.payload)).toEqual(stamp);
  expect(stored!.payload).not.toContain('proof');
  expect(stored!.payload).not.toContain(proof);
  expect(bindings.HUB.idFromName).toHaveBeenCalledWith('main');
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toBe('http://hub/publish');
  expect(publish.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const event = JSON.parse(String(publish.mock.calls[0][1]?.body)) as ChangeEvent;
  expect(event).toEqual({ id: stored!.id, type: 'stampPressed', payload: stamp, createdAt: now });
  expect(JSON.stringify(event)).not.toContain('proof');
  expect(JSON.stringify(event)).not.toContain(proof);
});

it.each(['congestion-1', 'congestion-2', 'congestion-3', 'congestion-4', 'congestion-5'])('%s の期限は設定された分数を押した時刻に足す', async kind => {
  config.configureConfig({ CONGESTION_TTL_MIN: 7 });
  const stamp = await pressed({ kind, at });
  expect(stamp.kind).toBe(kind);
  expect(stamp.pressedAt).toBe(now);
  expect(stamp.expiresAt).toBe('2026-11-28T02:12:06.789Z');
});

it.each(['fun', 'food', 'good'])('%s の期限は設定された当日の日本時間の閉場', async kind => {
  config.configureConfig({ CLOSING_TIME: '17:45', CONGESTION_TTL_MIN: 1 });
  const stamp = await pressed({ kind, at });
  expect(stamp.kind).toBe(kind);
  expect(stamp.expiresAt).toBe('2026-11-28T08:45:00.000Z');
});

it.each([
  ['2026-11-28T14:59:59.999Z', '2026-11-28T07:00:00.000Z'],
  ['2026-11-28T15:00:00.000Z', '2026-11-29T07:00:00.000Z'],
  ['2026-11-30T15:30:00.000Z', '2026-12-01T07:00:00.000Z'],
  ['2026-12-31T15:30:00.000Z', '2027-01-01T07:00:00.000Z'],
])('感想の期限は UTC の日付ではなく日本時間の日付を使う: %s', async (NOW, expected) => {
  config.configureConfig({ CLOSING_TIME: '16:00' });
  const stamp = await pressed({ kind: 'food', at }, { NOW });
  expect(stamp.expiresAt).toBe(expected);
});

it('混雑の期限は閉場・日付をまたいでも TTL を足す', async () => {
  config.configureConfig({ CONGESTION_TTL_MIN: 30 });
  const stamp = await pressed(input, { NOW: '2026-11-28T23:50:00.000Z' });
  expect(stamp.expiresAt).toBe('2026-11-29T00:20:00.000Z');
});

it('固定時刻がオフセット付きでも保存・応答の時刻は UTC', async () => {
  const stamp = await pressed({ kind: 'good', at }, { NOW: '2026-11-29T00:30:00+09:00' });
  expect(stamp.pressedAt).toBe('2026-11-28T15:30:00.000Z');
  expect(stamp.expiresAt).toBe('2026-11-29T07:00:00.000Z');
});

it.each([
  { lat: at.lat + 0.1, lng: at.lng },
  { lat: at.lat - 0.1, lng: at.lng },
  { lat: at.lat, lng: at.lng + 0.1 },
  { lat: at.lat, lng: at.lng - 0.1 },
])('会場範囲の外は 400 out_of_venue で何も保存しない: %j', async outside => {
  const response = await press({ kind: 'food', at: outside });
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'out_of_venue', message: expect.any(String), field: 'at' });
  await expectNoWrites();
});

it.each([
  { lat: savedConfig.VENUE_BOUNDS.north, lng: savedConfig.VENUE_BOUNDS.east },
  { lat: savedConfig.VENUE_BOUNDS.north, lng: savedConfig.VENUE_BOUNDS.west },
  { lat: savedConfig.VENUE_BOUNDS.south, lng: savedConfig.VENUE_BOUNDS.east },
  { lat: savedConfig.VENUE_BOUNDS.south, lng: savedConfig.VENUE_BOUNDS.west },
])('会場の境界上は受け入れる: %j', async boundary => {
  expect((await pressed({ kind: 'food', at: boundary })).at).toEqual(boundary);
});

it('会場範囲の設定変更を検証に使う', async () => {
  config.configureConfig({ VENUE_BOUNDS: { north: 1, south: -1, east: 2, west: -2 } });
  const outside = await press();
  expect(outside.status).toBe(400);
  expect(await outside.json()).toMatchObject({ code: 'out_of_venue', field: 'at' });
  await expectNoWrites();
  expect((await pressed({ kind: 'food', at: { lat: 0, lng: 0 } })).at).toEqual({ lat: 0, lng: 0 });
});

it.each([undefined, null, '', 'congestion', 'congestion-0', 'congestion-6', 'FOOD', '混雑', 3, [], {}])('不正な kind は 400 invalid_input: %j', async kind => {
  const response = await press({ kind, at });
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'invalid_input', message: expect.any(String), field: 'kind' });
  await expectNoWrites();
});

it.each([
  undefined, null, [], {}, { lat: at.lat }, { lng: at.lng },
  { lat: '37.4252', lng: at.lng }, { lat: at.lat, lng: '138.7788' },
  { lat: null, lng: at.lng }, { lat: at.lat, lng: true },
  { lat: 90.001, lng: at.lng }, { lat: -90.001, lng: at.lng },
  { lat: at.lat, lng: 180.001 }, { lat: at.lat, lng: -180.001 },
])('不正な at は 400 invalid_input: %j', async invalidAt => {
  const response = await press({ kind: 'food', at: invalidAt });
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'invalid_input', message: expect.any(String), field: 'at' });
  await expectNoWrites();
});

it.each(['', '{', 'null', '[]', '42', '"food"', '{"kind":"food","at":{"lat":1e999,"lng":138.7788}}'])('壊れた JSON・オブジェクト以外・非有限値も400で何も保存しない: %s', async body => {
  const response = await requestWithEnv('/api/stamps', {
    method: 'POST', headers: pressHeaders(), body,
  }, bindings);
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toMatchObject({ code: 'invalid_input', message: expect.any(String) });
  await expectNoWrites();
});

it('クライアントが送った ID・期限・proof・押した人などを保存・応答・配信に使わない', async () => {
  const stamp = await pressed({
    ...input, id: 'client-id', pressedAt: '2000-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
    proof: 'client-proof', by: 'visitor', ip: '192.0.2.1', at: { ...at, accuracy: 123 },
  });
  expect(stamp.id).not.toBe('client-id');
  expect(stamp.proof).not.toBe('client-proof');
  expect(stamp.pressedAt).toBe(now);
  expect(stamp.expiresAt).toBe('2026-11-28T02:35:06.789Z');
  expect(stamp.at).toEqual(at);
  expect(Object.keys(stamp).sort()).toEqual(['at', 'expiresAt', 'id', 'kind', 'pressedAt', 'proof']);
  const row = await env.DB.prepare('SELECT * FROM stamps').first();
  for (const value of ['client-id', 'client-proof', 'visitor', '192.0.2.1', 'accuracy']) {
    expect(JSON.stringify([row, await changeRow(), publish.mock.calls])).not.toContain(value);
  }
});

it('応答・changes・配信の本文を入力のコピーでなく書き込み後の値から組み立てる', async () => {
  await env.DB.prepare(`CREATE TRIGGER press_test_rewrite AFTER INSERT ON stamps BEGIN
    UPDATE stamps SET kind = 'good', lat = 37.4253, lng = 138.7789,
      pressed_at = '2026-11-28T03:00:00.000Z', expires_at = '2026-11-28T07:00:00.000Z'
    WHERE id = NEW.id;
  END`).run();
  try {
    const { proof, ...stamp } = await pressed();
    expect(stamp).toEqual({
      id: expect.any(String), kind: 'good', at: { lat: 37.4253, lng: 138.7789 },
      pressedAt: '2026-11-28T03:00:00.000Z', expiresAt: '2026-11-28T07:00:00.000Z',
    });
    const row = await env.DB.prepare('SELECT kind, lat, lng, pressed_at, expires_at FROM stamps WHERE id = ?').bind(stamp.id).first();
    expect(row).toEqual({ kind: stamp.kind, lat: stamp.at.lat, lng: stamp.at.lng, pressed_at: stamp.pressedAt, expires_at: stamp.expiresAt });
    expect(JSON.parse((await changeRow())!.payload)).toEqual(stamp);
    expect(JSON.parse(String(publish.mock.calls[0][1]?.body)).payload).toEqual(stamp);
    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
  } finally {
    await env.DB.prepare('DROP TRIGGER press_test_rewrite').run();
  }
});

it('履歴の保存に失敗するとスタンプもロールバックし、500 problem を返し配信しない', async () => {
  await env.DB.prepare(`CREATE TRIGGER press_test_reject_change BEFORE INSERT ON changes BEGIN
    SELECT RAISE(ABORT, 'test change failure');
  END`).run();
  try {
    const response = await press();
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toEqual({ code: 'internal_error', message: expect.any(String) });
    await expectNoWrites();
  } finally {
    await env.DB.prepare('DROP TRIGGER press_test_reject_change').run();
  }
});

it.each(['reject', 'non-ok'] as const)('Hub 配信の %s でも保存した stamp と changes を残して201を返す', async mode => {
  publish.mockImplementation(async () => {
    if (mode === 'reject') throw new Error('Hub unavailable');
    return new Response('Hub unavailable', { status: 503 });
  });
  const { proof, ...stamp } = await pressed();
  expect(await env.DB.prepare('SELECT id FROM stamps').first('id')).toBe(stamp.id);
  expect(JSON.parse((await changeRow())!.payload)).toEqual(stamp);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

it('正常・入力エラー・DBエラーでも押した人・通信元・地点をログへ出さない', async () => {
  const logs = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
  const spies = logs.map(method => vi.spyOn(console, method).mockImplementation(() => {}));
  const init = {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
    body: JSON.stringify({ ...input, by: 'visitor' }),
  };
  expect((await requestWithEnv('/api/stamps', init, bindings)).status).toBe(201);
  expect((await press({ kind: 'food', at: { lat: 0, lng: 0 } })).status).toBe(400);
  vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error(`DB failure: visitor 192.0.2.1 ${at.lat} ${at.lng}`));
  const response = await requestWithEnv('/api/stamps', init, bindings);
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toEqual({ code: 'internal_error', message: expect.any(String) });
  for (const value of ['visitor', '192.0.2.1', String(at.lat), String(at.lng)]) {
    expect(JSON.stringify(body)).not.toContain(value);
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it('閉場後の感想は expiresAt が pressedAt より前になり、即期限切れのまま保存する', async () => {
  config.configureConfig({ CLOSING_TIME: '16:00' });
  const stamp = await pressed({ kind: 'good', at }, { NOW: '2026-11-28T08:00:00.000Z' });
  expect(stamp.pressedAt).toBe('2026-11-28T08:00:00.000Z');
  expect(stamp.expiresAt).toBe('2026-11-28T07:00:00.000Z');
  expect(Date.parse(stamp.expiresAt)).toBeLessThan(Date.parse(stamp.pressedAt));
});

it('実行コンテキストがあれば Hub への publish は waitUntil に回し、応答を待たせない', async () => {
  let release!: () => void;
  publish.mockImplementation(() => new Promise<Response>(resolve => { release = () => resolve(new Response(null, { status: 204 })); }));
  const waited: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { waited.push(p); }, passThroughOnException: () => {} } as unknown as ExecutionContext;
  const { default: app } = await import('../src/app');
  const response = await app.fetch(new Request('http://local/api/stamps', {
    method: 'POST', headers: pressHeaders(), body: JSON.stringify(input),
  }), bindings, ctx);
  expect(response.status).toBe(201);
  expect(waited).toHaveLength(1);
  expect(publish).toHaveBeenCalledTimes(1);
  release();
  await Promise.all(waited);
});
