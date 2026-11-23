import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { migrateTestDb, operatorEnv, requestWithEnv } from './helpers';

const now = '2026-11-24T02:00:00.000Z';
const previousAt = '2026-11-23T02:00:00.000Z';
const previousFootprint = [{ lat: 37.425, lng: 138.778 }, { lat: 37.426, lng: 138.778 }, { lat: 37.425, lng: 138.779 }];
const footprint = [
  { lat: 37.42465, lng: 138.77785 }, { lat: 37.42465, lng: 138.77795 },
  { lat: 37.42455, lng: 138.77795 }, { lat: 37.42455, lng: 138.77785 },
];
// Fixed Overpass response; global fetch is always replaced before requests.
const overpass = { version: 0.6, elements: [{
  type: 'way', id: 101, tags: { building: 'yes' }, geometry: [
    { lat: 37.42465, lon: 138.77785 }, { lat: 37.42465, lon: 138.77795 },
    { lat: 37.42455, lon: 138.77795 }, { lat: 37.42455, lon: 138.77785 },
    { lat: 37.42465, lon: 138.77785 },
  ],
}] };
const fetchMock = vi.fn<typeof fetch>();
let bindings: Env;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  await migrateTestDb();
});
beforeEach(async () => {
  fetchMock.mockReset().mockRejectedValue(new Error('External network is disabled in tests'));
  bindings = operatorEnv({ NOW: now });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM places'),
    env.DB.prepare('DELETE FROM landmarks'),
    env.DB.prepare(`INSERT INTO landmarks (id, name, lat, lng, footprint, footprint_at)
      VALUES ('lm_a', 'A 棟', 37.4246, 138.7779, ?, ?)`).bind(JSON.stringify(previousFootprint), previousAt),
    env.DB.prepare(`INSERT INTO landmarks (id, name, lat, lng, footprint, footprint_at)
      VALUES ('lm_other', '別棟', 37.426, 138.779, NULL, NULL)`),
    ...[2, -1, 1].map(floor => env.DB.prepare(`INSERT INTO floor_plans
      (landmark_id, floor, view_box, d, north, south, east, west)
      VALUES ('lm_a', ?, '0 0 400 240', ?, 37.4248, 37.4244, 138.7782, 138.7776)`)
      .bind(floor, `M${floor} 10 H390 V230 H10 Z`)),
    env.DB.prepare(`INSERT INTO floor_plans
      (landmark_id, floor, view_box, d, north, south, east, west)
      VALUES ('lm_other', 5, '0 0 10 10', 'M0 0 H10 V10 Z', 37.427, 37.425, 138.780, 138.778)`),
  ]);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

function reload(id = 'lm_a') {
  return requestWithEnv(`/api/landmarks/${id}/footprint`, { method: 'POST' }, bindings);
}
async function saved() {
  return env.DB.prepare("SELECT * FROM landmarks WHERE id = 'lm_a'").first();
}
async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code, message: expect.any(String) });
}

it('取得した輪郭と取得時刻を更新し、階を昇順に含むLandmarkを200で返す', async () => {
  fetchMock.mockResolvedValueOnce(Response.json(overpass));
  const response = await reload();
  expect(response.status).toBe(200);
  const body = await response.json() as { footprint: unknown[] };
  expect(body).toEqual({
    id: 'lm_a', name: 'A 棟', location: { lat: 37.4246, lng: 138.7779 }, footprint,
    floors: [-1, 1, 2].map(floor => ({
      floor, plan: { viewBox: '0 0 400 240', d: `M${floor} 10 H390 V230 H10 Z` },
      bounds: { north: 37.4248, south: 37.4244, east: 138.7782, west: 138.7776 },
    })),
  });
  expect(body.footprint.length).toBeGreaterThanOrEqual(3);
  expect(await saved()).toEqual({
    id: 'lm_a', name: 'A 棟', lat: 37.4246, lng: 138.7779,
    footprint: JSON.stringify(footprint), footprint_at: now,
  });
  expect(await env.DB.prepare("SELECT footprint, footprint_at FROM landmarks WHERE id = 'lm_other'").first())
    .toEqual({ footprint: null, footprint_at: null });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0][1]!;
  expect(new URLSearchParams(String(init.body)).get('data')).toContain('around:10,37.4246,138.7779');
});

it('輪郭と階のない建物でも取得に成功すれば更新し、floorsは空で返す', async () => {
  await env.DB.batch([
    env.DB.prepare("UPDATE landmarks SET footprint = NULL, footprint_at = NULL WHERE id = 'lm_a'"),
    env.DB.prepare("DELETE FROM floor_plans WHERE landmark_id = 'lm_a'"),
  ]);
  fetchMock.mockResolvedValueOnce(Response.json(overpass));
  const response = await reload();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    id: 'lm_a', name: 'A 棟', location: { lat: 37.4246, lng: 138.7779 }, footprint, floors: [],
  });
  expect(await saved()).toMatchObject({ footprint: JSON.stringify(footprint), footprint_at: now });
});

it.each(['結果なし', '非2xx', '通信エラー', '頂点不足'])('%sでは502を返し、輪郭・取得時刻・階を変えない', async failure => {
  const before = await saved();
  const floors = await env.DB.prepare("SELECT * FROM floor_plans WHERE landmark_id = 'lm_a' ORDER BY floor").all();
  if (failure === '結果なし') fetchMock.mockResolvedValueOnce(Response.json({ elements: [] }));
  if (failure === '非2xx') fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
  if (failure === '頂点不足') fetchMock.mockResolvedValueOnce(Response.json({ elements: [{
    ...overpass.elements[0], geometry: overpass.elements[0].geometry.slice(0, 2),
  }] }));
  await expectProblem(await reload(), 502, 'footprint_unavailable');
  expect(await saved()).toEqual(before);
  expect((await env.DB.prepare("SELECT * FROM floor_plans WHERE landmark_id = 'lm_a' ORDER BY floor").all()).results)
    .toEqual(floors.results);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('元の輪郭がnullのときも取得失敗ではnullと取得時刻を保持する', async () => {
  await env.DB.prepare("UPDATE landmarks SET footprint = NULL, footprint_at = NULL WHERE id = 'lm_a'").run();
  const before = await saved();
  fetchMock.mockResolvedValueOnce(Response.json({ elements: [] }));
  await expectProblem(await reload(), 502, 'footprint_unavailable');
  expect(await saved()).toEqual(before);
});

it('存在しないidは404を返し、Overpassを呼ばない', async () => {
  const before = await saved();
  await expectProblem(await reload('missing'), 404, 'not_found');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await saved()).toEqual(before);
});

it('ACCESS_BYPASSなしの未認可要求は401を返し、取得・更新しない', async () => {
  const before = await saved();
  await expectProblem(await requestWithEnv('/api/landmarks/lm_a/footprint', { method: 'POST' },
    { ...bindings, ACCESS_BYPASS: undefined }), 401, 'unauthorized');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await saved()).toEqual(before);
});

it('応答はUPDATE後にDBから読み直した名前・位置・輪郭を使う', async () => {
  const trigger = [
    "CREATE TRIGGER footprint_saved_values AFTER UPDATE OF footprint ON landmarks WHEN NEW.id = 'lm_a' BEGIN",
    "UPDATE landmarks SET name = '保存後の名前', lat = 37.42461, lng = 138.77791,",
    `footprint = '[{"lat":37.4,"lng":138.7},{"lat":37.5,"lng":138.7},{"lat":37.4,"lng":138.8}]' WHERE id = NEW.id; END`,
  ].join(' ');
  await env.DB.exec(trigger);
  try {
    fetchMock.mockResolvedValueOnce(Response.json(overpass));
    const response = await reload();
    expect(response.status).toBe(200);
    const row = (await saved())!;
    expect(await response.json()).toMatchObject({
      id: row.id, name: '保存後の名前', location: { lat: row.lat, lng: row.lng },
      footprint: JSON.parse(row.footprint as string),
    });
  } finally {
    await env.DB.exec('DROP TRIGGER footprint_saved_values');
  }
});

it('DB更新が失敗した場合は500を返し、以前の輪郭を保持する', async () => {
  const before = await saved();
  await env.DB.exec(`CREATE TRIGGER reject_footprint_update BEFORE UPDATE ON landmarks BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try {
    fetchMock.mockResolvedValueOnce(Response.json(overpass));
    await expectProblem(await reload(), 500, 'internal_error');
    expect(await saved()).toEqual(before);
  } finally {
    await env.DB.exec('DROP TRIGGER reject_footprint_update');
  }
});
