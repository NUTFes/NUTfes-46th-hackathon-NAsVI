import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import type { components } from '../src/schema';
import { migrateTestDb, operatorEnv, request, requestWithEnv } from './helpers';

type FloorPlan = components['schemas']['FloorPlan'];
type FloorPlanInput = components['schemas']['FloorPlanInput'];
type Place = components['schemas']['Place'];
const input: FloorPlanInput = {
  plan: { viewBox: '0 0 400 240', d: 'M10 10 H390 V230 H10 Z M200 10 V230' },
  bounds: { north: 37.4248, south: 37.4244, east: 138.7782, west: 138.7776 },
};
const replacement: FloorPlanInput = {
  plan: { viewBox: '0 0 100 80', d: 'M0 0 H100 V80 H0 Z' },
  bounds: { north: 37.425, south: 37.424, east: 138.779, west: 138.777 },
};
const footprint = [
  { lat: 37.4248, lng: 138.7776 }, { lat: 37.4248, lng: 138.7782 },
  { lat: 37.4244, lng: 138.7782 }, { lat: 37.4244, lng: 138.7776 },
];
const landmark = {
  id: 'lm_a', name: 'A 棟', location: { lat: 37.4246, lng: 138.7779 }, footprint: null, floors: [],
};
const now = '2026-11-28T01:00:00.000Z';
const morning = { start: now, end: '2026-11-28T03:00:00.000Z' };
const afternoon = { start: '2026-11-28T04:00:00.000Z', end: '2026-11-28T07:00:00.000Z' };
const externalFetch = vi.fn(() => Promise.reject(new Error('External network is disabled in tests')));
const publish = vi.fn(async () => new Response(null, { status: 204 }));
let bindings: Env;

function path(floor: number | string = 1, id = 'lm_a') {
  return `/api/landmarks/${encodeURIComponent(id)}/floors/${encodeURIComponent(floor)}/plan`;
}

function put(body: unknown = input, floor: number | string = 1, id = 'lm_a') {
  return requestWithEnv(path(floor, id), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, bindings);
}

function remove(floor: number | string = 1, id = 'lm_a') {
  return requestWithEnv(path(floor, id), { method: 'DELETE' }, bindings);
}

async function expectProblem(response: Response, status: number, code: string, field?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code, message: expect.any(String), ...(field ? { field } : {}) });
}

async function plans() {
  return (await env.DB.prepare('SELECT * FROM floor_plans ORDER BY landmark_id, floor').all()).results;
}

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: 'pl_event', name: '屋台', kind: 'event', location: landmark.location, description: '模擬店',
    landmarkId: 'lm_a', floor: 1, hours: [], labelIds: [], ...overrides,
  };
}

async function insertPlace(value: Place) {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO places
      (id, name, kind, lat, lng, description, search_text, landmark_id, floor, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(value.id, value.name, value.kind, value.location.lat, value.location.lng,
        value.description, value.name.normalize('NFKC').toLowerCase(), value.landmarkId, value.floor, now),
    ...value.hours.map(period => env.DB.prepare('INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?)')
      .bind(value.id, period.start, period.end)),
    ...value.labelIds.map(id => env.DB.prepare('INSERT INTO place_labels (place_id, label_id) VALUES (?, ?)')
      .bind(value.id, id)),
  ]);
}

beforeAll(async () => {
  vi.stubGlobal('fetch', externalFetch);
  await migrateTestDb();
});
beforeEach(async () => {
  externalFetch.mockClear();
  publish.mockClear();
  bindings = operatorEnv({ HUB: {
    idFromName: vi.fn(() => 'main-id'), get: vi.fn(() => ({ fetch: publish })),
  } as unknown as Env['HUB'] });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM place_labels'), env.DB.prepare('DELETE FROM place_hours'),
    env.DB.prepare('DELETE FROM places'), env.DB.prepare('DELETE FROM labels'),
    env.DB.prepare('DELETE FROM floor_plans'), env.DB.prepare('DELETE FROM landmarks'),
    env.DB.prepare('DELETE FROM changes'),
    env.DB.prepare('INSERT INTO landmarks (id, name, lat, lng) VALUES (?, ?, ?, ?), (?, ?, ?, ?)')
      .bind('lm_a', 'A 棟', landmark.location.lat, landmark.location.lng, 'lm_b', 'B 棟', 37.425, 138.778),
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(externalFetch).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  // Building attachments have no changes event type in the contract.
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
});
afterAll(() => { vi.unstubAllGlobals(); });

it('PUT は plan と bounds を登録し、OpenAPI の FloorPlan を 200 で返す', async () => {
  const response = await put();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ floor: 1, ...input });
  expect(await plans()).toEqual([{
    landmark_id: 'lm_a', floor: 1, view_box: input.plan.viewBox, d: input.plan.d, ...input.bounds,
  }]);
});

it('同じ建物・階への PUT は全項目を上書きし、再送しても行を増やさない', async () => {
  expect((await put()).status).toBe(200);
  for (let i = 0; i < 2; i++) {
    const response = await put(replacement);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ floor: 1, ...replacement });
  }
  expect(await plans()).toEqual([{
    landmark_id: 'lm_a', floor: 1, view_box: replacement.plan.viewBox, d: replacement.plan.d, ...replacement.bounds,
  }]);
});

it('別の階・別の建物の見取り図と、建物・場所を変えない', async () => {
  await insertPlace(place());
  expect((await put(input, -1)).status).toBe(200);
  expect((await put(input, 1, 'lm_b')).status).toBe(200);
  expect((await put()).status).toBe(200);
  expect((await put(replacement)).status).toBe(200);
  expect((await remove()).status).toBe(204);
  expect(await plans()).toEqual([
    { landmark_id: 'lm_a', floor: -1, view_box: input.plan.viewBox, d: input.plan.d, ...input.bounds },
    { landmark_id: 'lm_b', floor: 1, view_box: input.plan.viewBox, d: input.plan.d, ...input.bounds },
  ]);
  const response = await request('/api/landmarks/lm_a/places');
  expect(await response.json()).toEqual({ landmark: { ...landmark, floors: [{ floor: -1, ...input }] }, items: [place()] });
});

it.each([-5, -1, 0, 20])('階 %s を登録・削除できる', async floor => {
  const response = await put(input, floor);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ floor, ...input });
  const deleted = await remove(floor);
  expect(deleted.status).toBe(204);
  expect(await deleted.text()).toBe('');
  expect(await plans()).toEqual([]);
  await expectProblem(await remove(floor), 404, 'not_found');
});

it('PUT は入力の推測値でなく書き込み後に読み直した値を返す', async () => {
  await env.DB.prepare(`CREATE TRIGGER adjust_plan AFTER INSERT ON floor_plans
    BEGIN UPDATE floor_plans SET d = 'M0 0 H10' WHERE landmark_id = NEW.landmark_id AND floor = NEW.floor; END`).run();
  try {
    const response = await put();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ floor: 1, ...input, plan: { ...input.plan, d: 'M0 0 H10' } });
    expect(await env.DB.prepare('SELECT d FROM floor_plans').first('d')).toBe('M0 0 H10');
  } finally {
    await env.DB.prepare('DROP TRIGGER adjust_plan').run();
  }
});

it.each(['0 0 400 240', '0,0,400,240', ' -1.5, +2e1 4e2, .5\t'])('有効な viewBox %j と bounds を登録できる', async viewBox => {
  const body = { plan: { ...input.plan, viewBox }, bounds: { north: 0, south: -1, east: 0, west: -1 } };
  const response = await put(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ floor: 1, ...body });
});

it.each(['-6', '21', '1.5', '1abc', 'NaN', 'Infinity', '0x1', '1e0', '1.0', ' '])(
  '不正な階 %j は PUT が 400、DELETE が 404 で既存図を変更しない', async floor => {
    expect((await put()).status).toBe(200);
    const before = await plans();
    await expectProblem(await put(replacement, floor), 400, 'invalid_input', 'floor');
    await expectProblem(await remove(floor), 404, 'not_found');
    expect(await plans()).toEqual(before);
  },
);

it.each([
  ['plan なし', { bounds: input.bounds }, 'plan'],
  ['plan が null', { ...input, plan: null }, 'plan'],
  ['plan が配列', { ...input, plan: [] }, 'plan'],
  ['viewBox なし', { ...input, plan: { d: input.plan.d } }, 'plan'],
  ['viewBox が数値', { ...input, plan: { ...input.plan, viewBox: 400 } }, 'plan'],
  ...[
    '', ' ', '0 0 text 240', '0 0 400', '0 0 400 240 1',
    '0 0 0 240', '0 0 -1 240', '0 0 400 0', '0 0 400 -1',
    'NaN 0 400 240', '0 Infinity 400 240', '0 0 1e309 240',
    '0,,0,400,240', '0 0 0x100 240',
  ].map(viewBox => [`viewBox が不正: ${JSON.stringify(viewBox)}`, { ...input, plan: { ...input.plan, viewBox } }, 'plan']),
  ['d なし', { ...input, plan: { viewBox: input.plan.viewBox } }, 'plan'],
  ['d が null', { ...input, plan: { ...input.plan, d: null } }, 'plan'],
  ['d が空', { ...input, plan: { ...input.plan, d: '' } }, 'plan'],
  ['d が200001文字', { ...input, plan: { ...input.plan, d: 'x'.repeat(200001) } }, 'plan'],
  ['bounds なし', { plan: input.plan }, 'bounds'],
  ['bounds が null', { ...input, bounds: null }, 'bounds'],
  ['bounds が配列', { ...input, bounds: [] }, 'bounds'],
  ...(['north', 'south', 'east', 'west'] as const).flatMap(key => [
    [`${key} なし`, { ...input, bounds: { ...input.bounds, [key]: undefined } }, 'bounds'],
    [`${key} が文字列`, { ...input, bounds: { ...input.bounds, [key]: '37' } }, 'bounds'],
    [`${key} が null`, { ...input, bounds: { ...input.bounds, [key]: null } }, 'bounds'],
    ...['NaN', 'Infinity', '-Infinity'].map(value => [
      `${key} が ${value}`, { ...input, bounds: { ...input.bounds, [key]: value } }, 'bounds',
    ]),
  ]),
  ...[
    { north: input.bounds.south }, { north: input.bounds.south - 1 },
    { east: input.bounds.west }, { east: input.bounds.west - 1 },
  ].map(bounds => [`bounds の大小関係が不正: ${JSON.stringify(bounds)}`, { ...input, bounds: { ...input.bounds, ...bounds } }, 'bounds']),
  ['本文が null', null, 'body'], ['本文が配列', [], 'body'], ['本文が文字列', 'text', 'body'],
] as [string, unknown, string][])('%s は 400 と field を返し、既存図を変更しない', async (_title, body, field) => {
  expect((await put()).status).toBe(200);
  const before = await plans();
  await expectProblem(await put(body), 400, 'invalid_input', field);
  expect(await plans()).toEqual(before);
});

it.each(['', '{'])('空または壊れた JSON %j は 400 を返す', async body => {
  await expectProblem(await requestWithEnv(path(), { method: 'PUT', body }, bindings), 400, 'invalid_input', 'body');
  expect(await plans()).toEqual([]);
});

it.each(['PUT', 'DELETE'])('%s は運営でなければ本文や DB に触る前に 401 を返す', async method => {
  const prepare = vi.spyOn(env.DB, 'prepare');
  const response = await requestWithEnv(path(), {
    method, headers: { 'Cf-Access-Jwt-Assertion': 'invalid' }, ...(method === 'PUT' ? { body: '{' } : {}),
  });
  await expectProblem(response, 401, 'unauthorized');
  expect(prepare).not.toHaveBeenCalled();
});

it('存在しない建物への PUT・DELETE と見取り図のない階の DELETE は 404 を返す', async () => {
  await expectProblem(await put(input, 1, 'missing'), 404, 'not_found');
  await expectProblem(await remove(1, 'missing'), 404, 'not_found');
  await expectProblem(await remove(), 404, 'not_found');
  expect(await plans()).toEqual([]);
});

it('保存直前に建物が削除されても PUT は 404 を返す', async () => {
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(async statements => {
    await env.DB.prepare('DELETE FROM landmarks WHERE id = ?').bind('lm_a').run();
    return batch(statements);
  });
  await expectProblem(await put(), 404, 'not_found');
  expect(await plans()).toEqual([]);
});

it('d が上限の200000文字の PUT は登録できる', async () => {
  const body = { ...input, plan: { ...input.plan, d: input.plan.d.padEnd(200000, ' ') } };
  expect(body.plan.d.length).toBe(200000);
  expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThan(1024 * 1024);
  const response = await put(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ floor: 1, ...body });
});

it.each(['ascii', 'utf8', 'content-length'])('1 MB を超える %s の本文は 413 で既存図を変更しない', async mode => {
  expect((await put()).status).toBe(200);
  const before = await plans();
  const body = JSON.stringify({ ...input, plan: { ...input.plan, d: mode === 'utf8' ? 'あ'.repeat(350000) : 'x'.repeat(1024 * 1024) } });
  const bytes = new TextEncoder().encode(body).length;
  expect(bytes).toBeGreaterThan(1024 * 1024);
  if (mode === 'utf8') expect(body.length).toBeLessThan(1024 * 1024);
  const response = await requestWithEnv(path(), {
    method: 'PUT', body, ...(mode === 'content-length' ? { headers: { 'Content-Length': String(bytes) } } : {}),
  }, bindings);
  await expectProblem(response, 413, 'payload_too_large');
  expect(await plans()).toEqual(before);
});

it('PUT の保存に失敗すると既存図を残して 500 problem+json を返す', async () => {
  expect((await put()).status).toBe(200);
  const before = await plans();
  await env.DB.prepare(`CREATE TRIGGER fail_plan_update BEFORE UPDATE ON floor_plans
    BEGIN SELECT RAISE(ABORT, 'test failure'); END`).run();
  try {
    await expectProblem(await put(replacement), 500, 'internal_error');
    expect(await plans()).toEqual(before);
  } finally {
    await env.DB.prepare('DROP TRIGGER fail_plan_update').run();
  }
});

it('DELETE の保存に失敗すると既存図を残して 500 problem+json を返す', async () => {
  expect((await put()).status).toBe(200);
  const before = await plans();
  await env.DB.prepare(`CREATE TRIGGER fail_plan_delete BEFORE DELETE ON floor_plans
    BEGIN SELECT RAISE(ABORT, 'test failure'); END`).run();
  try {
    await expectProblem(await remove(), 500, 'internal_error');
    expect(await plans()).toEqual(before);
  } finally {
    await env.DB.prepare('DROP TRIGGER fail_plan_delete').run();
  }
});

it('PUT の書き込み後の読み取りに失敗すると書き込みもロールバックする', async () => {
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(statements => batch([
    statements[0], env.DB.prepare('SELECT * FROM nonexistent_table'),
  ]));
  await expectProblem(await put(), 500, 'internal_error');
  expect(await plans()).toEqual([]);
});

it('建物に場所や見取り図がなければ認証なしで landmark と空の items を返す', async () => {
  const response = await request('/api/landmarks/lm_a/places');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ landmark, items: [] });
});

it('登録・上書き・削除した見取り図と輪郭を landmark に含め、階順で返す', async () => {
  await env.DB.prepare('UPDATE landmarks SET footprint = ? WHERE id = ?').bind(JSON.stringify(footprint), 'lm_a').run();
  for (const floor of [20, 1, -5]) expect((await put(input, floor)).status).toBe(200);
  expect((await put(replacement, 1)).status).toBe(200);
  expect((await remove(20)).status).toBe(204);
  const response = await request('/api/landmarks/lm_a/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    landmark: { ...landmark, footprint, floors: [{ floor: -5, ...input }, { floor: 1, ...replacement }] }, items: [],
  });
});

it('指定建物の企画・駐車場だけを返し、設備4種・屋外・別棟を除外する', async () => {
  const event = place();
  const parking = place({ id: 'pl_parking', name: '駐車場', kind: 'parking', floor: null });
  await insertPlace(event);
  await insertPlace(parking);
  for (const kind of ['info', 'wc', 'rest', 'trash'] as const) await insertPlace(place({ id: kind, kind }));
  await insertPlace(place({ id: 'outside', landmarkId: null, floor: null }));
  await insertPlace(place({ id: 'other', landmarkId: 'lm_b' }));
  const response = await request('/api/landmarks/lm_a/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ landmark, items: [event, parking] });
});

it('設備しかない建物も items が空になる', async () => {
  for (const kind of ['info', 'wc', 'rest', 'trash'] as const) await insertPlace(place({ id: kind, kind }));
  const response = await request('/api/landmarks/lm_a/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ landmark, items: [] });
});

it('複数の開催時間とラベルを場所ごとに結び付け、UTC .000Z の保存値と空配列を返す', async () => {
  await env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?), (?, ?)')
    .bind('lb_food', '飲食', 'lb_show', '展示').run();
  const first = place({ id: 'a', name: 'A', hours: [morning, afternoon], labelIds: ['lb_food', 'lb_show'] });
  const second = place({ id: 'b', name: 'B', floor: -1, hours: [afternoon], labelIds: ['lb_show'] });
  const empty = place({ id: 'c', name: 'C', floor: null });
  await insertPlace({ ...first, hours: [afternoon, morning], labelIds: ['lb_show', 'lb_food'] });
  await insertPlace(second);
  await insertPlace(empty);
  await insertPlace(place({ id: 'other', landmarkId: 'lm_b', hours: [morning], labelIds: ['lb_food'] }));
  const response = await request('/api/landmarks/lm_a/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ landmark, items: [first, second, empty] });
});

it('多数の場所も切り捨てず、関連データと一緒に返す', async () => {
  await env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?)').bind('lb_food', '飲食').run();
  const items = Array.from({ length: 105 }, (_, i) => place({
    id: `pl_${String(i).padStart(3, '0')}`, hours: [morning], labelIds: ['lb_food'],
  }));
  for (const item of items) await insertPlace(item);
  const response = await request('/api/landmarks/lm_a/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ landmark, items });
});

it('読み取り直後に更新されても建物・見取り図・場所・時間・種類を同じ時点の値で返す', async () => {
  expect((await put()).status).toBe(200);
  await env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?)').bind('lb_food', '飲食').run();
  const item = place({ hours: [morning], labelIds: ['lb_food'] });
  await insertPlace(item);
  const originalBatch = env.DB.batch.bind(env.DB);
  const batch = vi.spyOn(env.DB, 'batch').mockImplementationOnce(async statements => {
    const snapshot = await originalBatch(statements);
    await originalBatch([
      env.DB.prepare("UPDATE landmarks SET name = '更新後' WHERE id = 'lm_a'"),
      env.DB.prepare("DELETE FROM floor_plans WHERE landmark_id = 'lm_a'"),
      env.DB.prepare("UPDATE places SET name = '更新後' WHERE id = 'pl_event'"),
      env.DB.prepare('DELETE FROM place_hours'), env.DB.prepare('DELETE FROM place_labels'),
    ]);
    return snapshot;
  });
  const response = await requestWithEnv('/api/landmarks/lm_a/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ landmark: { ...landmark, floors: [{ floor: 1, ...input }] }, items: [item] });
  expect(batch).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare("SELECT name FROM landmarks WHERE id = 'lm_a'").first('name')).toBe('更新後');
});

it('存在しない建物の一覧は 404 problem+json を返す', async () => {
  await expectProblem(await request('/api/landmarks/missing/places'), 404, 'not_found');
});

it('一覧の D1 読み取りが失敗したら 500 problem+json を返す', async () => {
  vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('database failed'));
  await expectProblem(await requestWithEnv('/api/landmarks/lm_a/places'), 500, 'internal_error');
});
