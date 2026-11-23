import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import type { components } from '../src/schema';
import { fetchFootprint } from '../src/osm';
import { migrateTestDb, operatorEnv, requestWithEnv } from './helpers';

vi.mock('../src/osm', () => ({ fetchFootprint: vi.fn() }));

type Landmark = components['schemas']['Landmark'];
const now = '2026-11-24T01:00:00.000Z';
const input: components['schemas']['LandmarkInput'] = {
  name: 'A 棟', location: { lat: 37.4246, lng: 138.7779 },
};
const footprint: NonNullable<Landmark['footprint']> = [
  { lat: 37.4248, lng: 138.7776 }, { lat: 37.4248, lng: 138.7782 },
  { lat: 37.4244, lng: 138.7782 }, { lat: 37.4244, lng: 138.7776 },
];
const floorPlan: Landmark['floors'][number] = {
  floor: 2, plan: { viewBox: '0 0 400 240', d: 'M10 10 H390 V230 H10 Z' },
  bounds: { north: 37.4248, south: 37.4244, east: 138.7782, west: 138.7776 },
};
const original: Landmark = { ...input, id: 'lm_a', footprint, floors: [floorPlan] };
const externalFetch = vi.fn(() => Promise.reject(new Error('External network is disabled in tests')));
const publish = vi.fn(async () => new Response(null, { status: 204 }));
let bindings: Env;

function create(body: unknown = input) {
  return requestWithEnv('/api/landmarks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, bindings);
}
function patch(body: unknown, id = original.id) {
  return requestWithEnv(`/api/landmarks/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, bindings);
}
function remove(id = original.id) {
  return requestWithEnv(`/api/landmarks/${id}`, { method: 'DELETE' }, bindings);
}
async function list() {
  const response = await requestWithEnv('/api/landmarks', {}, { ...bindings, ACCESS_BYPASS: undefined });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  return response.json() as Promise<components['schemas']['LandmarkList']>;
}
async function expectProblem(response: Response, status: number, code: string, field?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code, message: expect.any(String), ...(field ? { field } : {}) });
}
async function seedLandmark() {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO landmarks (id, name, lat, lng, footprint, footprint_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(original.id, original.name, original.location.lat, original.location.lng, JSON.stringify(footprint), now),
    env.DB.prepare(`INSERT INTO floor_plans (landmark_id, floor, view_box, d, north, south, east, west)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(original.id, floorPlan.floor, floorPlan.plan.viewBox,
      floorPlan.plan.d, floorPlan.bounds.north, floorPlan.bounds.south, floorPlan.bounds.east, floorPlan.bounds.west),
  ]);
}
async function seedPlaces() {
  await env.DB.batch(['pl_a', 'pl_b'].map(id => env.DB.prepare(`INSERT INTO places
    (id, name, kind, lat, lng, description, search_text, landmark_id, floor, updated_at)
    VALUES (?, '企画', 'event', 37.4246, 138.7779, '', '企画', ?, 2, ?)`)
    .bind(id, original.id, now)));
}

beforeAll(async () => {
  vi.stubGlobal('fetch', externalFetch);
  await migrateTestDb();
});
beforeEach(async () => {
  externalFetch.mockClear();
  publish.mockClear();
  vi.mocked(fetchFootprint).mockReset();
  vi.mocked(fetchFootprint).mockResolvedValue(footprint);
  bindings = operatorEnv({
    NOW: now,
    HUB: { idFromName: vi.fn(() => 'main'), get: vi.fn(() => ({ fetch: publish })) } as unknown as Env['HUB'],
  });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM places'), env.DB.prepare('DELETE FROM landmarks'),
    env.DB.prepare('DELETE FROM changes'),
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(externalFetch).not.toHaveBeenCalled();
  // Landmark events are not part of the changes/SSE contract.
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
  expect(publish).not.toHaveBeenCalled();
});
afterAll(() => { vi.unstubAllGlobals(); });

it('認証なしで空の一覧を返す', async () => {
  expect(await list()).toEqual({ items: [] });
  expect(fetchFootprint).not.toHaveBeenCalled();
});

it('一覧は JSON の輪郭と階ごとの plan・bounds を復元し、輪郭・見取り図なしの建物も返す', async () => {
  await seedLandmark();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO landmarks (id, name, lat, lng) VALUES ('lm_b', 'B 棟', 0, 0)"),
    env.DB.prepare(`INSERT INTO floor_plans (landmark_id, floor, view_box, d, north, south, east, west)
      VALUES ('lm_a', -1, '0 0 10 10', 'M0 0 H10 V10 Z', 1, 0, 1, 0)`),
    env.DB.prepare(`INSERT INTO floor_plans (landmark_id, floor, view_box, d, north, south, east, west)
      VALUES ('lm_b', 1, '0 0 5 5', 'M0 0 H5 V5 Z', 5, 4, 3, 2)`),
    env.DB.prepare("INSERT INTO landmarks (id, name, lat, lng) VALUES ('lm_c', 'C 棟', 1, 1)"),
  ]);
  expect(await list()).toEqual({ items: [
    { ...original, floors: [
      { floor: -1, plan: { viewBox: '0 0 10 10', d: 'M0 0 H10 V10 Z' }, bounds: { north: 1, south: 0, east: 1, west: 0 } },
      floorPlan,
    ] },
    { id: 'lm_b', name: 'B 棟', location: { lat: 0, lng: 0 }, footprint: null, floors: [
      { floor: 1, plan: { viewBox: '0 0 5 5', d: 'M0 0 H5 V5 Z' }, bounds: { north: 5, south: 4, east: 3, west: 2 } },
    ] },
    { id: 'lm_c', name: 'C 棟', location: { lat: 1, lng: 1 }, footprint: null, floors: [] },
  ] });
  expect(fetchFootprint).not.toHaveBeenCalled();
});

it('登録は location で輪郭を取得し、JSON と取得時刻を保存して 201 の Landmark を返す', async () => {
  const response = await create();
  expect(response.status).toBe(201);
  expect(response.headers.get('content-type')).toContain('application/json');
  const landmark = await response.json() as Landmark;
  expect(landmark).toEqual({ ...input, id: expect.any(String), footprint, floors: [] });
  expect(landmark.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(fetchFootprint).toHaveBeenCalledExactlyOnceWith(input.location);
  expect(await env.DB.prepare('SELECT * FROM landmarks').first()).toEqual({
    id: landmark.id, name: input.name, lat: input.location.lat, lng: input.location.lng,
    footprint: JSON.stringify(footprint), footprint_at: now,
  });
  expect(await list()).toEqual({ items: [landmark] });
});

it.each(['null', '例外'])('輪郭取得が %s でも登録を通し、footprint と取得時刻を null にする', async mode => {
  if (mode === 'null') vi.mocked(fetchFootprint).mockResolvedValue(null);
  else vi.mocked(fetchFootprint).mockRejectedValue(new Error('OSM unavailable'));
  const response = await create();
  expect(response.status).toBe(201);
  const landmark = await response.json() as Landmark;
  expect(landmark).toEqual({ ...input, id: expect.any(String), footprint: null, floors: [] });
  expect(await env.DB.prepare('SELECT footprint, footprint_at FROM landmarks').first())
    .toEqual({ footprint: null, footprint_at: null });
  expect(await list()).toEqual({ items: [landmark] });
});

it('同名で登録でき、削除した ID を再利用しない', async () => {
  const first = await create();
  expect(first.status).toBe(201);
  const a = await first.json() as Landmark;
  const second = await create();
  expect(second.status).toBe(201);
  const b = await second.json() as Landmark;
  expect(b.id).not.toBe(a.id);
  expect((await remove(a.id)).status).toBe(204);
  const third = await create();
  expect(third.status).toBe(201);
  expect((await third.json() as Landmark).id).not.toBe(a.id);
});

it('PATCH は名前だけを更新し、輪郭・取得時刻・見取り図・位置を保つ', async () => {
  await seedLandmark();
  const response = await patch({ name: 'A 棟(本館)' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, name: 'A 棟(本館)' });
  expect(await env.DB.prepare('SELECT footprint_at FROM landmarks').first('footprint_at')).toBe(now);
  expect(await list()).toEqual({ items: [{ ...original, name: 'A 棟(本館)' }] });
  expect(fetchFootprint).not.toHaveBeenCalled();
});

it('場所が付いた建物も位置を更新でき、輪郭は取得し直さず保持する', async () => {
  await seedLandmark();
  await seedPlaces();
  const location = { lat: 38, lng: 139 };
  const response = await patch({ location });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, location });
  expect(await env.DB.prepare('SELECT lat, lng FROM landmarks').first()).toEqual(location);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM places').first('n')).toBe(2);
  expect(fetchFootprint).not.toHaveBeenCalled();
});

it('輪郭なしの建物も更新できる', async () => {
  await seedLandmark();
  await env.DB.prepare('UPDATE landmarks SET footprint = NULL, footprint_at = NULL').run();
  const response = await patch({ name: '形なし' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, name: '形なし', footprint: null });
});

it.each(['POST', 'PATCH'] as const)('%s の応答は書き込み後に読み直した DB の値を使う', async method => {
  if (method === 'PATCH') await seedLandmark();
  const trigger = method === 'POST' ? 'AFTER INSERT' : 'AFTER UPDATE OF name';
  await env.DB.exec(`CREATE TRIGGER canonical_landmark_name ${trigger} ON landmarks BEGIN UPDATE landmarks SET name = trim(NEW.name) WHERE id = NEW.id; END`);
  try {
    const response = method === 'POST' ? await create({ ...input, name: ' A 棟 ' }) : await patch({ name: ' A 棟 ' });
    expect(response.status).toBe(method === 'POST' ? 201 : 200);
    const current = await response.json() as Landmark;
    expect(current.name).toBe('A 棟');
    expect(await list()).toEqual({ items: [current] });
  } finally {
    await env.DB.exec('DROP TRIGGER canonical_landmark_name');
  }
});

it('クライアントからの footprint・floors・id は更新せず、既知の項目だけ反映する', async () => {
  await seedLandmark();
  const response = await patch({ name: '更新', id: 'other', footprint: null, floors: [], unknown: 'ignored' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, name: '更新' });
  expect(fetchFootprint).not.toHaveBeenCalled();
});

it('POST でもクライアントの footprint・floors・id は使わない', async () => {
  const response = await create({ ...input, id: 'client', footprint: null, floors: [floorPlan] });
  expect(response.status).toBe(201);
  const landmark = await response.json() as Landmark;
  expect(landmark).toEqual({ ...input, id: expect.any(String), footprint, floors: [] });
  expect(landmark.id).not.toBe('client');
});

const invalidFields: [Record<string, unknown>, string][] = [
  [{ name: '' }, 'name'], [{ name: 'あ'.repeat(51) }, 'name'], [{ name: '😀'.repeat(51) }, 'name'],
  [{ name: null }, 'name'], [{ name: 123 }, 'name'], [{ location: null }, 'location'],
  [{ location: [] }, 'location'], [{ location: {} }, 'location'],
  [{ location: { lat: 37 } }, 'location'], [{ location: { lng: 138 } }, 'location'],
  [{ location: { lat: '37', lng: 138 } }, 'location'], [{ location: { lat: 37, lng: null } }, 'location'],
  [{ location: { lat: -90.1, lng: 138 } }, 'location'], [{ location: { lat: 90.1, lng: 138 } }, 'location'],
  [{ location: { lat: 37, lng: -180.1 } }, 'location'], [{ location: { lat: 37, lng: 180.1 } }, 'location'],
];
it.each(invalidFields)('POST の不正な項目 %j は 400 と field を返し登録・OSM 呼び出しをしない', async (invalid, field) => {
  await expectProblem(await create({ ...input, ...invalid }), 400, 'invalid_input', field);
  expect(await list()).toEqual({ items: [] });
  expect(fetchFootprint).not.toHaveBeenCalled();
});
it.each(invalidFields)('PATCH の不正な項目 %j は 400 と field を返し変更しない', async (invalid, field) => {
  await seedLandmark();
  await expectProblem(await patch(invalid), 400, 'invalid_input', field);
  expect(await list()).toEqual({ items: [original] });
  expect(fetchFootprint).not.toHaveBeenCalled();
});
it.each([
  [null, 'body'], [[], 'body'], ['text', 'body'], [{}, 'name'],
  [{ name: input.name }, 'location'], [{ location: input.location }, 'name'],
] as const)('POST の必須入力が不正な %j は 400', async (body, field) => {
  await expectProblem(await create(body), 400, 'invalid_input', field);
  expect(await list()).toEqual({ items: [] });
  expect(fetchFootprint).not.toHaveBeenCalled();
});
it.each([{}, null, [], 'text', { unknown: true }, { footprint }, { floors: [] }, { id: 'other' }])(
  'PATCH が空または未知の項目だけの %j は 400', async body => {
    await seedLandmark();
    await expectProblem(await patch(body), 400, 'invalid_input', 'body');
    expect(await list()).toEqual({ items: [original] });
    expect(fetchFootprint).not.toHaveBeenCalled();
  },
);

it.each(['POST', 'PATCH'] as const)('%s は壊れた JSON に 400 を返す', async method => {
  const path = method === 'POST' ? '/api/landmarks' : '/api/landmarks/lm_a';
  await expectProblem(await requestWithEnv(path, { method, body: '{' }, bindings), 400, 'invalid_input', 'body');
  expect(await list()).toEqual({ items: [] });
  expect(fetchFootprint).not.toHaveBeenCalled();
});

it.each([
  { name: 'あ', location: { lat: -90, lng: -180 } },
  { name: 'あ'.repeat(50), location: { lat: 90, lng: 180 } },
  { name: '😀'.repeat(50), location: { lat: 0, lng: 0 } },
])('名前・座標の境界値 %j を登録・更新できる', async body => {
  const created = await create(body);
  expect(created.status).toBe(201);
  const landmark = await created.json() as Landmark;
  expect(landmark).toMatchObject(body);
  const updated = await patch(body, landmark.id);
  expect(updated.status).toBe(200);
  expect(await updated.json()).toEqual(landmark);
});

it('削除は 204 の空本文を返し、その建物の見取り図だけを連動して削除する', async () => {
  await seedLandmark();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO landmarks (id, name, lat, lng) VALUES ('lm_b', 'B 棟', 0, 0)"),
    env.DB.prepare(`INSERT INTO floor_plans (landmark_id, floor, view_box, d, north, south, east, west)
      VALUES ('lm_b', 1, '0 0 10 10', 'M0 0 H10 V10 Z', 1, 0, 1, 0)`),
  ]);
  const response = await remove();
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(response.headers.get('content-type')).toBeNull();
  expect(await env.DB.prepare('SELECT id FROM landmarks WHERE id = ?').bind(original.id).first()).toBeNull();
  expect((await env.DB.prepare('SELECT landmark_id FROM floor_plans').all()).results).toEqual([{ landmark_id: 'lm_b' }]);
  expect(await env.DB.prepare("SELECT id FROM landmarks WHERE id = 'lm_b'").first('id')).toBe('lm_b');
  expect(fetchFootprint).not.toHaveBeenCalled();
});

it('場所が付いた建物の削除は件数つきの 409 landmark_in_use とし、建物・見取り図・場所を残す', async () => {
  await seedLandmark();
  await seedPlaces();
  const response = await remove();
  expect(response.status).toBe(409);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'landmark_in_use', message: 'A 棟には 2 件の場所が付いています' });
  expect(await list()).toEqual({ items: [original] });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM places').first('n')).toBe(2);
  // Releasing all places makes the building deletable.
  await env.DB.prepare('UPDATE places SET landmark_id = NULL, floor = NULL').run();
  expect((await remove()).status).toBe(204);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM floor_plans').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM places').first('n')).toBe(2);
});

it('未登録・削除済み ID の PATCH と DELETE は 404', async () => {
  await expectProblem(await patch({ name: '不存在' }), 404, 'not_found');
  await expectProblem(await remove(), 404, 'not_found');
  await seedLandmark();
  expect((await remove()).status).toBe(204);
  await expectProblem(await remove(), 404, 'not_found');
  await expectProblem(await patch({ name: '削除済み' }), 404, 'not_found');
});

it.each(['POST', 'PATCH', 'DELETE'] as const)('%s は運営の認証なしなら 401 とし変更しない', async method => {
  await seedLandmark();
  const path = method === 'POST' ? '/api/landmarks' : '/api/landmarks/lm_a';
  await expectProblem(await requestWithEnv(path, { method, body: method === 'DELETE' ? undefined : JSON.stringify(input) },
    { ...bindings, ACCESS_BYPASS: undefined }), 401, 'unauthorized');
  expect(await list()).toEqual({ items: [original] });
  expect(fetchFootprint).not.toHaveBeenCalled();
});

it.each(['GET', 'POST', 'PATCH', 'DELETE'] as const)('%s の DB 障害は 500 problem とする', async method => {
  await seedLandmark();
  const path = method === 'GET' || method === 'POST' ? '/api/landmarks' : '/api/landmarks/lm_a';
  const prepare = vi.spyOn(env.DB, 'prepare').mockImplementation(() => { throw new Error('DB unavailable'); });
  try {
    await expectProblem(await requestWithEnv(path, {
      method, body: method === 'POST' || method === 'PATCH' ? JSON.stringify(input) : undefined,
    }, bindings), 500, 'internal_error');
  } finally {
    prepare.mockRestore();
  }
  expect(await list()).toEqual({ items: [original] });
});

it('削除処理が失敗した場合は 500 とし、見取り図も削除しない', async () => {
  await seedLandmark();
  await env.DB.exec("CREATE TRIGGER reject_landmark_delete BEFORE DELETE ON landmarks BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    await expectProblem(await remove(), 500, 'internal_error');
    expect(await list()).toEqual({ items: [original] });
  } finally {
    await env.DB.exec('DROP TRIGGER reject_landmark_delete');
  }
});
