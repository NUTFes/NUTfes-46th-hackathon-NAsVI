import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { migrateTestDb, operatorEnv, requestWithEnv } from './helpers';

const now = '2026-11-24T02:00:00.000Z';
const original = {
  id: 'pl_01', name: '模擬店', kind: 'event', location: { lat: 37.425, lng: 138.778 },
  description: '元の説明', landmarkId: 'lm_a', floor: 2,
  hours: [{ start: '2026-11-28T01:00:00.000Z', end: '2026-11-28T03:00:00.000Z' }],
  labelIds: ['lb_food'],
};
const publish = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
let bindings: Env;

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});
beforeEach(async () => {
  publish.mockClear();
  bindings = operatorEnv({
    NOW: now,
    HUB: { idFromName: vi.fn(() => 'main'), get: vi.fn(() => ({ fetch: publish })) } as unknown as Env['HUB'],
  });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM places'), env.DB.prepare('DELETE FROM landmarks'),
    env.DB.prepare('DELETE FROM labels'), env.DB.prepare('DELETE FROM changes'),
    env.DB.prepare("INSERT INTO landmarks (id, name, lat, lng) VALUES ('lm_a', 'A棟', 37.425, 138.778)"),
    env.DB.prepare(`INSERT INTO places
      (id, name, kind, lat, lng, description, search_text, landmark_id, floor, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      original.id, original.name, original.kind, original.location.lat, original.location.lng,
      original.description, original.name, original.landmarkId, original.floor, '2026-11-23T00:00:00.000Z'),
    env.DB.prepare('INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?)')
      .bind(original.id, original.hours[0].start, original.hours[0].end),
    env.DB.prepare("INSERT INTO labels (id, title) VALUES ('lb_food', '飲食')"),
    env.DB.prepare("INSERT INTO place_labels (place_id, label_id) VALUES ('pl_01', 'lb_food')"),
  ]);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

function patch(body: unknown, id = original.id) {
  return requestWithEnv(`/api/places/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, bindings);
}
async function expectProblem(response: Response, status: number, code: string, field?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code, message: expect.any(String), ...(field ? { field } : {}) });
}
async function expectNoChange() {
  expect(await env.DB.prepare('SELECT name, description, updated_at FROM places WHERE id = ?')
    .bind(original.id).first()).toEqual({ name: original.name, description: original.description, updated_at: '2026-11-23T00:00:00.000Z' });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
  expect(publish).not.toHaveBeenCalled();
}

it('名前だけを部分更新し、検索名と Place 全項目の履歴を同じ batch に保存する', async () => {
  const batch = vi.spyOn(env.DB, 'batch');
  const response = await patch({ name: 'ＡＢＣ ﾌｰﾄﾞ' });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  const place = { ...original, name: 'ＡＢＣ ﾌｰﾄﾞ' };
  expect(await response.json()).toEqual(place);
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(2);
  expect(await env.DB.prepare('SELECT name, search_text, updated_at FROM places WHERE id = ?')
    .bind(original.id).first()).toEqual({ name: place.name, search_text: 'abc フード', updated_at: now });
  const change = await env.DB.prepare('SELECT * FROM changes').first();
  expect(change).toEqual({ id: expect.any(Number), type: 'placeUpdated', payload: JSON.stringify(place), created_at: now });
  expect(publish).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({
    id: change!.id, type: 'placeUpdated', payload: place, createdAt: now,
  });
});

it('説明・位置・建物と階を部分更新し、空文字と明示的な null を反映する', async () => {
  const update = { description: '', location: { lat: 38, lng: 139 }, landmarkId: null, floor: null };
  const response = await patch(update);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, ...update });
  expect(await env.DB.prepare('SELECT description, lat, lng, landmark_id, floor FROM places WHERE id = ?')
    .bind(original.id).first()).toEqual({ description: '', lat: 38, lng: 139, landmark_id: null, floor: null });
});

it('hours は追記せず全置換し、UTC で保存して履歴と同じ batch に含める', async () => {
  const batch = vi.spyOn(env.DB, 'batch');
  const response = await patch({ hours: [
    { start: '2026-11-28T13:00:00+09:00', end: '2026-11-28T15:00:00+09:00' },
    { start: '2026-11-29T10:00:00+09:00', end: '2026-11-29T12:00:00+09:00' },
  ] });
  const hours = [
    { start: '2026-11-28T04:00:00.000Z', end: '2026-11-28T06:00:00.000Z' },
    { start: '2026-11-29T01:00:00.000Z', end: '2026-11-29T03:00:00.000Z' },
  ];
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, hours });
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(5);
  expect((await env.DB.prepare('SELECT start_at AS start, end_at AS end FROM place_hours ORDER BY start_at').all()).results).toEqual(hours);
  expect(JSON.parse((await env.DB.prepare('SELECT payload FROM changes').first<string>('payload'))!))
    .toEqual({ ...original, hours });
});

it('hours の空配列で開催時間をすべて消す', async () => {
  const response = await patch({ hours: [] });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, hours: [] });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM place_hours').first('n')).toBe(0);
});

it('存在する別の建物への付け替えを許す', async () => {
  await env.DB.prepare("INSERT INTO landmarks (id, name, lat, lng) VALUES ('lm_b', 'B棟', 37.425, 138.778)").run();
  const response = await patch({ landmarkId: 'lm_b', floor: -5 });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, landmarkId: 'lm_b', floor: -5 });
});

it.each(['event', 'parking', null])('kind=%s は現在値と同じでも 400 にする', async kind => {
  await expectProblem(await patch({ name: '変更不可', kind }), 400, 'invalid_input', 'kind');
  await expectNoChange();
});

it.each([
  [{}, undefined], [null, undefined], [[], undefined], ['text', undefined],
  [{ name: '' }, 'name'], [{ name: 'あ'.repeat(51) }, 'name'], [{ name: null }, 'name'],
  [{ description: 'あ'.repeat(501) }, 'description'], [{ description: null }, 'description'],
  [{ location: { lat: 91, lng: 138 } }, 'location'], [{ location: { lat: 0, lng: -181 } }, 'location'],
  [{ location: { lat: 0 } }, 'location'], [{ location: null }, 'location'],
  [{ floor: -6 }, 'floor'], [{ floor: 21 }, 'floor'], [{ floor: 1.5 }, 'floor'],
  [{ landmarkId: 123 }, 'landmarkId'], [{ landmarkId: 'missing' }, 'landmarkId'],
  [{ landmarkId: null }, 'floor'], [{ hours: null }, 'hours'],
  [{ hours: [{ start: 'tomorrow', end: '2026-11-28T04:00:00Z' }] }, 'hours'],
  [{ hours: [{ start: '2026-02-30T01:00:00Z', end: '2026-11-28T04:00:00Z' }] }, 'hours'],
  [{ hours: [{ start: '2026-11-28T01:00:00Z' }] }, 'hours'],
  [{ hours: [original.hours[0], original.hours[0]] }, 'hours'],
] as const)('不正な入力 %j は 400 とし本体も履歴も変えない', async (body, field) => {
  await expectProblem(await patch(body), 400, 'invalid_input', field);
  await expectNoChange();
});

it('JSON が壊れている場合は 400 を返す', async () => {
  await expectProblem(await requestWithEnv('/api/places/pl_01', { method: 'PATCH', body: '{' }, bindings),
    400, 'invalid_input');
  await expectNoChange();
});

it('建物の外に階を指定すると 400 を返す', async () => {
  await env.DB.prepare('UPDATE places SET landmark_id = NULL, floor = NULL WHERE id = ?').bind(original.id).run();
  await expectProblem(await patch({ floor: 1 }), 400, 'invalid_input', 'floor');
  await expectNoChange();
});

it('文字数・座標・階の境界値を許す', async () => {
  const update = { name: '😀'.repeat(50), description: '😀'.repeat(500), location: { lat: -90, lng: 180 }, floor: 20 };
  const response = await patch(update);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...original, ...update });
});

it('未登録の id は 404 とし、batch と publish を呼ばない', async () => {
  const batch = vi.spyOn(env.DB, 'batch');
  await expectProblem(await patch({ name: '不存在' }, 'missing'), 404, 'not_found');
  expect(batch).not.toHaveBeenCalled();
  await expectNoChange();
});

it('認証がない場合は 401 を返し、更新しない', async () => {
  const response = await requestWithEnv('/api/places/pl_01', { method: 'PATCH', body: '{"name":"不可"}' },
    { ...bindings, ACCESS_BYPASS: undefined });
  await expectProblem(response, 401, 'unauthorized');
  await expectNoChange();
});

it('履歴の挿入失敗は更新・hours の置換もロールバックし、500 problem を返す', async () => {
  await env.DB.exec("CREATE TRIGGER reject_place_update_change BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    await expectProblem(await patch({ name: '失敗する名前', hours: [] }), 500, 'internal_error');
    await expectNoChange();
    expect((await env.DB.prepare('SELECT start_at AS start, end_at AS end FROM place_hours').all()).results).toEqual(original.hours);
  } finally {
    await env.DB.exec('DROP TRIGGER reject_place_update_change');
  }
});

it('未知の項目だけの PATCH は 400 とし、変更も履歴の配信もしない', async () => {
  await expectProblem(await patch({ foo: 1 }), 400, 'invalid_input');
  await expectNoChange();
});

it('読み取り後に別の運営が別の項目を直しても、応答と配信の本文は DB の現在値になる', async () => {
  const realBatch = env.DB.batch.bind(env.DB);
  let raced = false;
  vi.spyOn(env.DB, 'batch').mockImplementation((async (statements: D1PreparedStatement[]) => {
    if (!raced) {
      raced = true;
      await env.DB.prepare("UPDATE places SET description = '別の運営の説明' WHERE id = 'pl_01'").run();
    }
    return realBatch(statements);
  }) as typeof env.DB.batch);

  const response = await patch({ name: '新しい名前' });
  expect(response.status).toBe(200);
  const body = await response.json() as { name: string; description: string };
  expect(body.name).toBe('新しい名前');
  expect(body.description).toBe('別の運営の説明');

  const rows = (await env.DB.prepare('SELECT payload FROM changes ORDER BY id').all<{ payload: string }>()).results;
  const last = JSON.parse(rows[rows.length - 1].payload);
  expect(last).toEqual(body);
  const published = JSON.parse(publish.mock.calls[publish.mock.calls.length - 1][1]?.body as string);
  expect(published.payload).toEqual(body);
});

it('end が start より前の hours は 400(field=hours)とし、変更しない', async () => {
  await expectProblem(await patch({ hours: [{ start: '2026-11-28T03:00:00.000Z', end: '2026-11-28T01:00:00.000Z' }] }),
    400, 'invalid_input', 'hours');
  await expectNoChange();
  expect((await env.DB.prepare('SELECT start_at AS start, end_at AS end FROM place_hours').all()).results).toEqual(original.hours);
});
