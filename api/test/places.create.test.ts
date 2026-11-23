import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import type { components } from '../src/schema';
import { migrateTestDb, operatorEnv, requestWithEnv } from './helpers';

type Place = components['schemas']['Place'];
type PlaceInput = components['schemas']['PlaceInput'];
const now = '2026-11-24T01:00:00.000Z';
const input: PlaceInput = {
  name: 'ＡＢＣ ﾌｰﾄﾞ', kind: 'event', location: { lat: 37.4249, lng: 138.7781 },
  description: '2 年生の模擬店', landmarkId: 'kougi', floor: 1,
  hours: [
    { start: '2026-11-28T11:00:00+09:00', end: '2026-11-28T15:00:00+09:00' },
    { start: '2026-11-29T02:00:00.000Z', end: '2026-11-29T06:00:00.000Z' },
  ],
};
const publish = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
const externalFetch = vi.fn(() => Promise.reject(new Error('External network is disabled in tests')));
let bindings: Env;

function create(body: unknown, overrides: Partial<Env> = {}) {
  return requestWithEnv('/api/places', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { ...bindings, ...overrides });
}

async function expectNoWrites() {
  for (const table of ['places', 'place_hours', 'place_labels', 'changes']) {
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')).toBe(0);
  }
  expect(publish).not.toHaveBeenCalled();
}

beforeAll(async () => {
  vi.stubGlobal('fetch', externalFetch);
  await migrateTestDb();
});
beforeEach(async () => {
  publish.mockReset();
  publish.mockImplementation(async () => new Response(null, { status: 204 }));
  externalFetch.mockClear();
  const hub = {
    idFromName: vi.fn(() => 'main-id'), get: vi.fn(() => ({ fetch: publish })),
  } as unknown as Env['HUB'];
  bindings = operatorEnv({ NOW: now, HUB: hub });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM place_labels'), env.DB.prepare('DELETE FROM place_hours'),
    env.DB.prepare('DELETE FROM places'), env.DB.prepare('DELETE FROM landmarks'),
    env.DB.prepare('DELETE FROM changes'),
    env.DB.prepare('INSERT INTO landmarks (id, name, lat, lng) VALUES (?, ?, ?, ?)')
      .bind('kougi', '講義棟', 37.4249, 138.7781),
  ]);
});
afterEach(() => {
  expect(externalFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
afterAll(() => { vi.unstubAllGlobals(); });

it('201 の Place と、場所・検索文字列・全開催時間・placeAdded を 1 batch で保存し Hub に publish する', async () => {
  const batch = vi.spyOn(env.DB, 'batch');
  const response = await create(input);
  expect(response.status).toBe(201);
  expect(response.headers.get('content-type')).toContain('application/json');
  const place = await response.json() as Place;
  expect(place).toEqual({ ...input, id: expect.any(String), labelIds: [] });
  expect(place.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(4);
  expect(await env.DB.prepare('SELECT * FROM places').first()).toEqual({
    id: place.id, name: input.name, kind: input.kind, lat: input.location.lat, lng: input.location.lng,
    description: input.description, search_text: 'abc フード', landmark_id: 'kougi', floor: 1, updated_at: now,
  });
  expect((await env.DB.prepare('SELECT * FROM place_hours ORDER BY start_at').all()).results).toEqual(
    input.hours!.map(period => ({ place_id: place.id, start_at: period.start, end_at: period.end })),
  );
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM place_labels').first('n')).toBe(0);
  const changes = (await env.DB.prepare('SELECT * FROM changes').all()).results;
  expect(changes).toEqual([{
    id: expect.any(Number), type: 'placeAdded', payload: JSON.stringify(place), created_at: now,
  }]);
  expect(bindings.HUB.idFromName).toHaveBeenCalledWith('main');
  expect(bindings.HUB.get).toHaveBeenCalledWith('main-id');
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toBe('http://hub/publish');
  expect(publish.mock.calls[0][1]?.method).toBe('POST');
  expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({
    id: changes[0].id, type: 'placeAdded', payload: place, createdAt: now,
  });
});

it('任意項目の省略は landmarkId・floor が null、hours・labelIds が空になる', async () => {
  const minimal = { name: '屋外企画', kind: 'event', location: input.location, description: '' };
  const response = await create(minimal);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    ...minimal, id: expect.any(String), landmarkId: null, floor: null, hours: [], labelIds: [],
  });
  expect(await env.DB.prepare('SELECT landmark_id, floor FROM places').first()).toEqual({ landmark_id: null, floor: null });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM place_hours').first('n')).toBe(0);
});

it.each(['event', 'parking', 'info', 'wc', 'rest', 'trash'] as const)('%s は屋外・開催時間なしで登録できる', async kind => {
  const response = await create({ ...input, kind, landmarkId: null, floor: null, hours: [] });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ kind, landmarkId: null, floor: null, hours: [] });
});

it.each([-5, 0, 20, null, undefined])('建物があるとき floor=%s を許す', async floor => {
  const response = await create({ ...input, floor });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ landmarkId: 'kougi', floor: floor ?? null });
});

it.each([
  { name: 'あ', description: '' },
  { name: 'あ'.repeat(50), description: '説'.repeat(500) },
  { name: '😀'.repeat(50), description: '😀'.repeat(500) },
])('文字数の境界を許し、名前を勝手に変更しない: $name', async text => {
  const response = await create({ ...input, ...text });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject(text);
});

it.each([
  ['同じ文字列', '2026-11-28T11:00:00+09:00', '2026-11-28T11:00:00+09:00'],
  ['同じ瞬間の別表記', '2026-11-28T11:00:00+09:00', '2026-11-28T02:00:00.000Z'],
])('hours の開始時刻が重複(%s)すると 400 invalid_input(field=hours)で何も保存しない', async (_name, a, b) => {
  const end = '2026-11-29T00:00:00Z';
  const response = await create({ ...input, hours: [{ start: a, end }, { start: b, end }] });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'invalid_input', field: 'hours' });
  await expectNoWrites();
});

it('同じ名前で登録でき、毎回別の ID を返す', async () => {
  const first = await create(input);
  const second = await create(input);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect((await first.json() as Place).id).not.toBe((await second.json() as Place).id);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(2);
});

const invalid: [string, Record<string, unknown>, string][] = [
  ['名前なし', { name: undefined }, 'name'],
  ['名前が空', { name: '' }, 'name'],
  ['名前が長い', { name: 'あ'.repeat(51) }, 'name'],
  ['絵文字の名前が長い', { name: '😀'.repeat(51) }, 'name'],
  ['名前が null', { name: null }, 'name'],
  ['名前が数値', { name: 1 }, 'name'],
  ['種別なし', { kind: undefined }, 'kind'],
  ['未定義の種別', { kind: 'facility' }, 'kind'],
  ['種別が null', { kind: null }, 'kind'],
  ['位置なし', { location: undefined }, 'location'],
  ['位置が null', { location: null }, 'location'],
  ['位置が配列', { location: [] }, 'location'],
  ['緯度なし', { location: { lng: 138 } }, 'location'],
  ['経度なし', { location: { lat: 37 } }, 'location'],
  ['緯度が文字列', { location: { lat: '37', lng: 138 } }, 'location'],
  ['経度が null', { location: { lat: 37, lng: null } }, 'location'],
  ['緯度が小さい', { location: { lat: -90.1, lng: 138 } }, 'location'],
  ['緯度が大きい', { location: { lat: 90.1, lng: 138 } }, 'location'],
  ['経度が小さい', { location: { lat: 37, lng: -180.1 } }, 'location'],
  ['経度が大きい', { location: { lat: 37, lng: 180.1 } }, 'location'],
  ['説明なし', { description: undefined }, 'description'],
  ['説明が長い', { description: '説'.repeat(501) }, 'description'],
  ['説明が null', { description: null }, 'description'],
  ['説明が数値', { description: 1 }, 'description'],
  ['建物が存在しない', { landmarkId: 'missing' }, 'landmarkId'],
  ['建物 ID が空', { landmarkId: '' }, 'landmarkId'],
  ['建物 ID が数値', { landmarkId: 1 }, 'landmarkId'],
  ['建物 ID が配列', { landmarkId: [] }, 'landmarkId'],
  ['屋外に階がある', { landmarkId: null, floor: 1 }, 'floor'],
  ['建物省略で階がある', { landmarkId: undefined, floor: 0 }, 'floor'],
  ['階が小さい', { floor: -6 }, 'floor'],
  ['階が大きい', { floor: 21 }, 'floor'],
  ['階が小数', { floor: 1.5 }, 'floor'],
  ['階が文字列', { floor: '1' }, 'floor'],
  ['時間帯が null', { hours: null }, 'hours'],
  ['時間帯がオブジェクト', { hours: {} }, 'hours'],
  ['時間帯の要素が null', { hours: [null] }, 'hours'],
  ['開始なし', { hours: [{ end: input.hours![0].end }] }, 'hours'],
  ['終了なし', { hours: [{ start: input.hours![0].start }] }, 'hours'],
  ['開始が数値', { hours: [{ start: 123, end: input.hours![0].end }] }, 'hours'],
  ['開始が日時でない', { hours: [{ start: 'tomorrow', end: input.hours![0].end }] }, 'hours'],
  ['存在しない日付', { hours: [{ start: '2026-02-30T11:00:00Z', end: input.hours![0].end }] }, 'hours'],
  ['時差なし', { hours: [{ start: '2026-11-28T11:00:00', end: input.hours![0].end }] }, 'hours'],
  ['終了が不正', { hours: [{ start: input.hours![0].start, end: '15:00' }] }, 'hours'],
];
it.each(invalid)('%s は 400 invalid_input と field を返し書き込まない', async (_title, patch, field) => {
  const batch = vi.spyOn(env.DB, 'batch');
  const response = await create({ ...input, ...patch });
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'invalid_input', message: expect.any(String), field });
  expect(batch).not.toHaveBeenCalled();
  await expectNoWrites();
});

it.each([null, [], 'text', 42])('本文 %j は 400 と field=body を返す', async body => {
  const response = await create(body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: 'invalid_input', message: expect.any(String), field: 'body' });
  await expectNoWrites();
});

it.each(['', '{'])('空または壊れた JSON %j は 400 と field=body を返す', async body => {
  const response = await requestWithEnv('/api/places', { method: 'POST', body }, bindings);
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'invalid_input', message: expect.any(String), field: 'body' });
  await expectNoWrites();
});

it.each([undefined, 'false', 'TRUE', '1'])('運営の迂回が %s のとき、偽の認証ヘッダーでも 401 を返す', async bypass => {
  const prepare = vi.spyOn(env.DB, 'prepare');
  const response = await requestWithEnv('/api/places', {
    method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, { ...bindings, ACCESS_BYPASS: bypass });
  expect(response.status).toBe(401);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'unauthorized', message: expect.any(String) });
  expect(prepare).not.toHaveBeenCalled();
  await expectNoWrites();
});

it('履歴の保存に失敗すると場所・検索文字列・開催時間も残さず、500 problem+json を返す', async () => {
  await env.DB.prepare(`CREATE TRIGGER fail_place_change BEFORE INSERT ON changes
    BEGIN SELECT RAISE(ABORT, 'test failure'); END`).run();
  try {
    const response = await create(input);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toEqual({ code: 'internal_error', message: expect.any(String) });
    await expectNoWrites();
  } finally {
    await env.DB.prepare('DROP TRIGGER fail_place_change').run();
  }
});

it.each(['reject', 'non-ok'])('Hub publish が %s でも保存済みの Place を 201 で返す', async mode => {
  publish.mockImplementationOnce(async () => {
    if (mode === 'reject') throw new Error('publish failed');
    return new Response(null, { status: 503 });
  });
  const response = await create(input);
  expect(response.status).toBe(201);
  const place = await response.json() as Place;
  expect(await env.DB.prepare('SELECT id FROM places').first('id')).toBe(place.id);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM place_hours').first('n')).toBe(2);
  expect(await env.DB.prepare('SELECT payload FROM changes').first('payload')).toBe(JSON.stringify(place));
});
