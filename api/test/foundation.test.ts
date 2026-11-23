import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { AppEnv, Env } from '../src/env';
import { problem } from '../src/lib/errors';
import { commitWithChange, type ChangeEvent } from '../src/lib/changes';
import { newId } from '../src/lib/ids';
import { nowIso } from '../src/lib/time';
import { normalize, escapeLike } from '../src/lib/normalize';
import { all, first, run } from '../src/lib/db';
import { requireOperator } from '../src/middleware/access';
import { fetchFootprint } from '../src/osm';
import * as config from '../src/config';
import { migrateTestDb, operatorEnv, request, requestAsOperator, requestWithEnv } from './helpers';

const specs = import.meta.glob<string>([
  '../../concept-design/api/openapi.yaml', '../../doc/impl/wbs.yaml',
], { eager: true, query: '?raw', import: 'default' });
const sources = import.meta.glob<string>('../src/**/*.ts', { eager: true, query: '?raw', import: 'default' });
const openapi = specs['../../concept-design/api/openapi.yaml'];
const wbs = specs['../../doc/impl/wbs.yaml'];

// Read the operation headings and security declarations directly from the spec.
const operations: { method: string; path: string; operator: boolean }[] = [];
let path = '';
for (const line of openapi.split('\n')) {
  if (line.startsWith('components:')) break;
  const heading = /^  (\/[^:]+):$/.exec(line);
  if (heading) path = heading[1];
  const method = /^    (get|post|put|patch|delete):$/.exec(line);
  if (method) operations.push({ method: method[1].toUpperCase(), path, operator: false });
  if (line.includes('- operatorAuth:')) operations[operations.length - 1].operator = true;
}
const stubs = operations.filter(op => op.path !== '/changes');
const concretePath = (path: string) => '/api' + path.replace(/\{floor\}/g, '1').replace(/\{[^}]+\}/g, 'example');

beforeAll(async () => {
  // Durable Object and SELF bindings are unaffected; all external fetches fail.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM changes'), env.DB.prepare('DELETE FROM meta'),
  ]);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

it('A-*・H-* が所有する API ソースをすべて置く', () => {
  const owned = wbs.split(/(?=^- id: )/m)
    .filter(task => /^- id: [AH]-/m.test(task))
    .flatMap(task => [...(task.split('  owns:\n')[1]?.split('  reads:\n')[0] ?? '')
      .matchAll(/^  - api\/src\/(.+)$/gm)].map(match => match[1]));
  expect(owned.length).toBeGreaterThan(0);
  for (const name of owned) {
    if (name.endsWith('/**')) {
      expect(Object.keys(sources).some(file => file.startsWith('../src/' + name.slice(0, -2)))).toBe(true);
    } else expect(Object.keys(sources)).toContain('../src/' + name);
  }
});

it.each(stubs)('$method $path は 501 problem+json を返す', async op => {
  const response = await requestAsOperator(concretePath(op.path), { method: op.method });
  expect(response.status).toBe(501);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'internal_error', message: expect.stringContaining('未実装') });
});

it.each(stubs.filter(op => op.operator))('$method $path は運営の迂回なしで 401', async op => {
  const response = await requestWithEnv(concretePath(op.path), { method: op.method }, { ...env, ACCESS_BYPASS: undefined });
  expect(response.status).toBe(401);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'unauthorized', message: expect.any(String) });
});

it.each(stubs.filter(op => !op.operator))('$method $path は認証不要', async op => {
  expect((await request(concretePath(op.path), { method: op.method })).status).toBe(501);
});

it('problem は独自の項目だけを返し、field は 400 のときだけ返す', async () => {
  const app = new Hono<AppEnv>();
  app.get('/bad', c => problem(c, 400, 'invalid_input', '名前を入れてください', 'name'));
  app.get('/failure', c => problem(c, 500, 'internal_error', '失敗', 'name'));
  const bad = await app.request('/bad');
  expect(bad.status).toBe(400);
  expect(bad.headers.get('content-type')).toBe('application/problem+json');
  expect(await bad.json()).toEqual({ code: 'invalid_input', message: '名前を入れてください', field: 'name' });
  expect(await (await app.request('/failure')).json()).toEqual({ code: 'internal_error', message: '失敗' });
});

it('requireOperator は true のときだけ actor を設定する', async () => {
  const app = new Hono<AppEnv>();
  app.get('/', requireOperator, c => c.json(c.get('actor')));
  for (const bypass of [undefined, 'false', 'TRUE', '1']) {
    const response = await app.request('/', {}, { ...env, ACCESS_BYPASS: bypass });
    expect(response.status).toBe(401);
  }
  const response = await app.request('/', {}, operatorEnv());
  expect(await response.json()).toEqual({ email: 'operator@example.com' });
});

function mockHub(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Env['HUB'] {
  return { idFromName: vi.fn(() => 'main-id'), get: vi.fn(() => ({ fetch })) } as unknown as Env['HUB'];
}

it('commitWithChange は本体と履歴を 1 batch で保存し、同じ id・時刻を publish する', async () => {
  const publish = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
  const bindings = { ...env, NOW: '2026-11-24T01:00:00.000Z', HUB: mockHub(publish) };
  const batch = vi.spyOn(env.DB, 'batch');
  const change = { type: 'appVersionChanged' as const, payload: { version: 'test' } };
  const { changeId } = await commitWithChange(bindings, [
    env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('app_version', 'test'),
  ], change);
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(2);
  expect(changeId).toBeGreaterThan(0);
  expect(await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('app_version').first('value')).toBe('test');
  expect(await env.DB.prepare('SELECT * FROM changes WHERE id = ?').bind(changeId).first()).toEqual({
    id: changeId, type: change.type, payload: JSON.stringify(change.payload), created_at: bindings.NOW,
  });
  expect(bindings.HUB.idFromName).toHaveBeenCalledWith('main');
  expect(publish.mock.calls[0][0]).toBe('http://hub/publish');
  expect(publish.mock.calls[0][1]?.method).toBe('POST');
  expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({ id: changeId, ...change, createdAt: bindings.NOW });
});

it('本体の batch が失敗すると履歴を残さず publish もしない', async () => {
  const publish = vi.fn(async () => new Response(null, { status: 204 }));
  await expect(commitWithChange({ ...env, HUB: mockHub(publish) }, [
    env.DB.prepare("INSERT INTO meta (key, value) VALUES ('duplicate', 'first')"),
    env.DB.prepare("INSERT INTO meta (key, value) VALUES ('duplicate', 'second')"),
  ], { type: 'placeRemoved', payload: { id: 'example' } })).rejects.toThrow();
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM meta').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
  expect(publish).not.toHaveBeenCalled();
});

it.each(['reject', 'non-ok'] as const)('publish の %s は保存済みリクエストを失敗にしない', async mode => {
  const publish = vi.fn(async () => {
    if (mode === 'reject') throw new Error('publish failed');
    return new Response('failed', { status: 503 });
  });
  const result = await commitWithChange({ ...env, HUB: mockHub(publish) }, [], { type: 'placeRemoved', payload: { id: 'example' } });
  expect(result.changeId).toBeGreaterThan(0);
  expect(await env.DB.prepare('SELECT id FROM changes').first('id')).toBe(result.changeId);
});

it('ctx があれば publish の完了を waitUntil に渡す', async () => {
  const ctx = createExecutionContext();
  const waitUntil = vi.spyOn(ctx, 'waitUntil');
  let finish!: (response: Response) => void;
  const publish = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  try {
    const result = await commitWithChange({ ...env, HUB: mockHub(publish) }, [], { type: 'placeRemoved', payload: { id: 'example' } }, ctx);
    expect(result.changeId).toBeGreaterThan(0);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  } finally {
    finish(new Response(null, { status: 204 }));
    await waitOnExecutionContext(ctx);
  }
});

it('GET /api/changes は main Hub に接続し、commitWithChange を配信する', async () => {
  const response = await request('/api/changes');
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected');
    const payload = { version: 'foundation' };
    const { changeId } = await commitWithChange(env, [], { type: 'appVersionChanged', payload });
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain(`id: ${changeId}\nevent: appVersionChanged\ndata: ${JSON.stringify(payload)}`);
  } finally { await reader.cancel(); }
});

it('GET /api/changes は since と Last-Event-ID を Hub に渡す', async () => {
  const first = await request('/dev/emit', { method: 'POST', body: '{}' });
  const firstId = (await first.json() as ChangeEvent).id;
  const second = await request('/api/dev/emit', { method: 'POST', body: '{}' });
  const secondId = (await second.json() as ChangeEvent).id;
  const response = await request('/api/changes?since=999', { headers: { 'Last-Event-ID': String(firstId) } });
  const reader = response.body!.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(`id: ${secondId}\nevent: stampPressed`);
  } finally { await reader.cancel(); }
});

it.each(['/dev/emit', '/api/dev/emit'])('%s は明示的に有効なときだけ使える', async path => {
  for (const enabled of [undefined, 'false']) {
    expect((await requestWithEnv(path, { method: 'POST', body: '{}' }, { ...env, ENABLE_DEV_EMIT: enabled })).status).toBe(404);
  }
  const response = await request(path, { method: 'POST', body: '{}' });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ id: expect.any(Number) });
});

it('dev/emit は publish が non-ok なら既存の 502 と保存済み id を返す', async () => {
  const bindings = { ...env, ENABLE_DEV_EMIT: 'true', HUB: mockHub(async () => new Response(null, { status: 503 })) };
  const response = await requestWithEnv('/dev/emit', { method: 'POST', body: '{}' }, bindings);
  expect(response.status).toBe(502);
  const body = await response.json() as { error: string; id: number };
  expect(body).toEqual({ error: 'publish failed', id: expect.any(Number) });
  expect(await env.DB.prepare('SELECT id FROM changes').first('id')).toBe(body.id);
});

it('ID・固定時刻・NFKC 検索・LIKE のエスケープを提供する', async () => {
  expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(nowIso({ ...env, NOW: '2026-11-24T01:00:00.000Z' })).toBe('2026-11-24T01:00:00.000Z');
  expect(new Date(nowIso({ ...env, NOW: undefined })).toISOString()).toBeDefined();
  expect(normalize('ＡＢＣ ﾌｰﾄﾞ')).toBe('abc フード');
  const value = '100%_\\';
  const pattern = `%${escapeLike(value)}%`;
  expect(await env.DB.prepare("SELECT ? LIKE ? ESCAPE '\\' AS matched").bind(value, pattern).first('matched')).toBe(1);
  expect(await env.DB.prepare("SELECT ? LIKE ? ESCAPE '\\' AS matched").bind('100food', pattern).first('matched')).toBe(0);
});

it('D1 の補助は bind した値・空の結果を扱う', async () => {
  await run(env.DB, 'INSERT INTO meta (key, value) VALUES (?, ?)', ['example', "quote' value"]);
  expect(await all<{ value: string }>(env.DB, 'SELECT value FROM meta WHERE key = ?', ['example'])).toEqual([{ value: "quote' value" }]);
  expect(await first(env.DB, 'SELECT value FROM meta WHERE key = ?', ['missing'])).toBeNull();
});

it('設定はテストから上書き・復元でき、OSM は通信せず未実装のエラーを返す', async () => {
  const saved = { CONGESTION_TTL_MIN: config.CONGESTION_TTL_MIN, CLOSING_TIME: config.CLOSING_TIME, ORIGIN: config.ORIGIN, VENUE_BOUNDS: config.VENUE_BOUNDS };
  try {
    config.configureConfig({ CONGESTION_TTL_MIN: 5, CLOSING_TIME: '17:00', ORIGIN: { lat: 0, lng: 0 }, VENUE_BOUNDS: { north: 1, south: -1, east: 1, west: -1 } });
    expect(config.CONGESTION_TTL_MIN).toBe(5);
    expect(config.CLOSING_TIME).toBe('17:00');
    expect(config.ORIGIN).toEqual({ lat: 0, lng: 0 });
    expect(config.VENUE_BOUNDS.north).toBe(1);
  } finally { config.configureConfig(saved); }
  await expect(fetchFootprint(config.ORIGIN)).rejects.toThrow('未実装');
});
