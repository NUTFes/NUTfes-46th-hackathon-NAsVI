import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '../src/schema';
import { migrateTestDb, requestAsOperator, requestWithEnv } from './helpers';

type Place = components['schemas']['Place'];
const path = '/api/places/place-1/labels/label-m';
const publish = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
const indoor: Place = {
  id: 'place-1', name: '展示会場', kind: 'event', location: { lat: 37.4252, lng: 138.7788 },
  description: '作品を展示します', landmarkId: 'landmark-1', floor: -1,
  hours: [
    { start: '2026-11-24T01:00:00.000Z', end: '2026-11-24T03:00:00.000Z' },
    { start: '2026-11-24T04:00:00.000Z', end: '2026-11-24T07:00:00.000Z' },
  ],
  labelIds: [],
};

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});

beforeEach(async () => {
  publish.mockClear();
  vi.spyOn(env.HUB, 'get').mockReturnValue({ fetch: publish } as unknown as ReturnType<typeof env.HUB.get>);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM place_labels'),
    env.DB.prepare('DELETE FROM place_hours'),
    env.DB.prepare('DELETE FROM places'),
    env.DB.prepare('DELETE FROM labels'),
    env.DB.prepare('DELETE FROM landmarks'),
    env.DB.prepare('DELETE FROM changes'),
    env.DB.prepare('INSERT INTO landmarks (id, name, lat, lng) VALUES (?, ?, ?, ?)')
      .bind('landmark-1', '講義棟', 37.4252, 138.7788),
    env.DB.prepare(`
      INSERT INTO places (id, name, kind, lat, lng, description, search_text, landmark_id, floor, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(indoor.id, indoor.name, indoor.kind, indoor.location.lat, indoor.location.lng,
      indoor.description, indoor.name, indoor.landmarkId, indoor.floor, '2026-11-24T00:00:00.000Z'),
    env.DB.prepare(`
      INSERT INTO places (id, name, kind, lat, lng, search_text, updated_at)
      VALUES ('place-2', '駐車場', 'parking', 37.4253, 138.7789, '駐車場', '2026-11-24T00:00:00.000Z')
    `),
    // Deliberately insert hours and labels out of their required output order.
    ...[...indoor.hours].reverse().map(hour => env.DB.prepare(
      'INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?)'
    ).bind(indoor.id, hour.start, hour.end)),
    env.DB.prepare("INSERT INTO labels (id, title) VALUES ('label-z', '展示'), ('label-m', '飲食'), ('label-a', '体験')"),
  ]);
});

afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

async function attachDirect(placeId = 'place-1', labelId = 'label-m') {
  await env.DB.prepare('INSERT INTO place_labels (place_id, label_id) VALUES (?, ?)').bind(placeId, labelId).run();
}

async function labelIds(placeId = 'place-1') {
  const { results } = await env.DB.prepare('SELECT label_id FROM place_labels WHERE place_id = ? ORDER BY label_id')
    .bind(placeId).all<{ label_id: string }>();
  return results.map(row => row.label_id);
}

async function changes() {
  const { results } = await env.DB.prepare('SELECT id, type, payload, created_at FROM changes ORDER BY id')
    .all<{ id: number; type: string; payload: string; created_at: string }>();
  return results.map(row => ({ ...row, payload: JSON.parse(row.payload) as Place }));
}

async function expectNoContent(response: Response) {
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(response.headers.get('content-type')).toBeNull();
}

async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  const body = await response.json() as { code: string; message: string };
  expect(body).toEqual({ code, message: expect.any(String) });
  return body;
}

it('未使用の種類を削除して本文なしの 204 を返し、changes を作らない', async () => {
  await expectNoContent(await requestAsOperator('/api/labels/label-m', { method: 'DELETE' }));
  expect(await env.DB.prepare("SELECT id FROM labels WHERE id = 'label-m'").first()).toBeNull();
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM labels').first('n')).toBe(2);
  expect(await changes()).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

it('2 件の場所で使われている種類は件数つきの 409 で、種類と付与を残す', async () => {
  await attachDirect();
  await attachDirect('place-2');
  const body = await expectProblem(await requestAsOperator('/api/labels/label-m', { method: 'DELETE' }), 409, 'label_in_use');
  expect(body.message).toContain('2 件');
  expect(await env.DB.prepare("SELECT id FROM labels WHERE id = 'label-m'").first()).not.toBeNull();
  expect(await labelIds()).toEqual(['label-m']);
  expect(await labelIds('place-2')).toEqual(['label-m']);
  expect(await changes()).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

it('存在しない種類の削除は 404 not_found', async () => {
  await expectProblem(await requestAsOperator('/api/labels/missing', { method: 'DELETE' }), 404, 'not_found');
  expect(await changes()).toEqual([]);
});

it('削除済みの種類を再度削除すると 404 not_found', async () => {
  await expectNoContent(await requestAsOperator('/api/labels/label-m', { method: 'DELETE' }));
  await expectProblem(await requestAsOperator('/api/labels/label-m', { method: 'DELETE' }), 404, 'not_found');
});

it('存在チェック後に付けられた種類も、条件つき DELETE により 409 で残す', async () => {
  const prepare = env.DB.prepare.bind(env.DB);
  vi.spyOn(env.DB, 'prepare').mockImplementationOnce(sql => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    vi.spyOn(statement, 'bind').mockImplementationOnce((...values) => {
      const bound = bind(...values);
      const first = bound.first.bind(bound);
      vi.spyOn(bound, 'first').mockImplementationOnce(async () => {
        const result = await first();
        await prepare("INSERT INTO place_labels (place_id, label_id) VALUES ('place-1', 'label-m')").run();
        return result;
      });
      return bound;
    });
    return statement;
  });
  const body = await expectProblem(await requestAsOperator('/api/labels/label-m', { method: 'DELETE' }), 409, 'label_in_use');
  expect(body.message).toContain('1 件');
  expect(await env.DB.prepare("SELECT id FROM labels WHERE id = 'label-m'").first()).not.toBeNull();
  expect(await labelIds()).toEqual(['label-m']);
  expect(await changes()).toEqual([]);
});

it('付与と全項目の placeUpdated を 1 batch で保存し、同じ payload を配信する', async () => {
  await attachDirect('place-1', 'label-z');
  await attachDirect('place-1', 'label-a');
  const batch = vi.spyOn(env.DB, 'batch');
  await expectNoContent(await requestAsOperator(path, { method: 'PUT' }));
  expect(batch).toHaveBeenCalledTimes(1);
  expect(await labelIds()).toEqual(['label-a', 'label-m', 'label-z']);
  const history = await changes();
  expect(history).toHaveLength(1);
  expect(history[0]).toEqual({
    id: expect.any(Number), type: 'placeUpdated',
    payload: { ...indoor, labelIds: ['label-a', 'label-m', 'label-z'] }, created_at: expect.any(String),
  });
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toBe('http://hub/publish');
  expect(publish.mock.calls[0][1]?.method).toBe('POST');
  expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({
    id: history[0].id, type: 'placeUpdated', payload: history[0].payload, createdAt: history[0].created_at,
  });
});

it('解除後の labelIds を保存し、他の種類と種類そのものを残す', async () => {
  await attachDirect('place-1', 'label-z');
  await attachDirect();
  await attachDirect('place-1', 'label-a');
  const batch = vi.spyOn(env.DB, 'batch');
  await expectNoContent(await requestAsOperator(path, { method: 'DELETE' }));
  expect(batch).toHaveBeenCalledTimes(1);
  expect(await labelIds()).toEqual(['label-a', 'label-z']);
  expect(await env.DB.prepare("SELECT id FROM labels WHERE id = 'label-m'").first()).not.toBeNull();
  expect(await changes()).toEqual([{
    id: expect.any(Number), type: 'placeUpdated',
    payload: { ...indoor, labelIds: ['label-a', 'label-z'] }, created_at: expect.any(String),
  }]);
});

it('屋外の場所の空の hours・null・最後の種類の解除をそのまま保存する', async () => {
  await attachDirect('place-2');
  await expectNoContent(await requestAsOperator('/api/places/place-2/labels/label-m', { method: 'DELETE' }));
  expect((await changes())[0].payload).toEqual({
    id: 'place-2', name: '駐車場', kind: 'parking', location: { lat: 37.4253, lng: 138.7789 },
    description: '', landmarkId: null, floor: null, hours: [], labelIds: [],
  });
});

it('付け直し・付いていない解除は 204 で changes と配信を追加しない', async () => {
  await expectNoContent(await requestAsOperator(path, { method: 'DELETE' }));
  expect(await changes()).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
  await expectNoContent(await requestAsOperator(path, { method: 'PUT' }));
  const attached = await changes();
  await expectNoContent(await requestAsOperator(path, { method: 'PUT' }));
  expect(await changes()).toEqual(attached);
  expect(publish).toHaveBeenCalledTimes(1);
  await expectNoContent(await requestAsOperator(path, { method: 'DELETE' }));
  const detached = await changes();
  expect(detached).toHaveLength(2);
  await expectNoContent(await requestAsOperator(path, { method: 'DELETE' }));
  expect(await changes()).toEqual(detached);
  expect(publish).toHaveBeenCalledTimes(2);
});

it('事前の存在チェック後に更新された名前・時間・別の labelIds も payload に反映する', async () => {
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(statements => batch([
    env.DB.prepare("UPDATE places SET name = '変更後の会場' WHERE id = 'place-1'"),
    env.DB.prepare("UPDATE place_hours SET end_at = '2026-11-24T08:00:00.000Z' WHERE place_id = 'place-1' AND start_at = '2026-11-24T04:00:00.000Z'"),
    env.DB.prepare("INSERT INTO place_labels (place_id, label_id) VALUES ('place-1', 'label-z')"),
    ...statements,
  ]));
  await expectNoContent(await requestAsOperator(path, { method: 'PUT' }));
  expect((await changes())[0].payload).toEqual({
    ...indoor, name: '変更後の会場', labelIds: ['label-m', 'label-z'],
    hours: [indoor.hours[0], { ...indoor.hours[1], end: '2026-11-24T08:00:00.000Z' }],
  });
});

it.each(['PUT', 'DELETE'])('%s の直前に同じ操作が完了していた場合も、履歴と配信を作らない', async method => {
  if (method === 'DELETE') await attachDirect();
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(statements => batch([
    env.DB.prepare(method === 'PUT'
      ? "INSERT INTO place_labels (place_id, label_id) VALUES ('place-1', 'label-m')"
      : "DELETE FROM place_labels WHERE place_id = 'place-1' AND label_id = 'label-m'"),
    ...statements,
  ]));
  await expectNoContent(await requestAsOperator(path, { method }));
  expect(await labelIds()).toEqual(method === 'PUT' ? ['label-m'] : []);
  expect(await changes()).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

it.each(['PUT', 'DELETE'])('%s: 場所が存在しない場合は 404 not_found', async method => {
  await expectProblem(await requestAsOperator('/api/places/missing/labels/label-m', { method }), 404, 'not_found');
  expect(await changes()).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

it.each(['PUT', 'DELETE'])('%s: 種類が存在しない場合は 404 label_not_found', async method => {
  await expectProblem(await requestAsOperator('/api/places/place-1/labels/missing', { method }), 404, 'label_not_found');
  expect(await labelIds()).toEqual([]);
  expect(await changes()).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

it.each(['PUT', 'DELETE'])('%s: 場所と種類の両方が無ければ 404 not_found', async method => {
  await expectProblem(await requestAsOperator('/api/places/missing/labels/missing', { method }), 404, 'not_found');
  expect(await changes()).toEqual([]);
});

it.each(['PUT', 'DELETE'])('%s: changes の書き込み失敗は付け外しもロールバックする', async method => {
  if (method === 'DELETE') await attachDirect();
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, 'batch').mockImplementationOnce(statements => batch([
    ...statements.slice(0, -1),
    env.DB.prepare("INSERT INTO changes (type, payload, created_at) VALUES ('invalid', '{}', '2026-11-24T00:00:00.000Z')"),
  ]));
  await expectProblem(await requestAsOperator(path, { method }), 500, 'internal_error');
  expect(await labelIds()).toEqual(method === 'DELETE' ? ['label-m'] : []);
  expect(await changes()).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

it.each([
  { url: '/api/labels/label-m', method: 'DELETE' },
  { url: path, method: 'PUT' },
  { url: path, method: 'DELETE' },
])('$method $url は ACCESS_BYPASS なしで 401、DB を変更しない', async ({ url, method }) => {
  await expectProblem(await requestWithEnv(url, { method }, { ...env, ACCESS_BYPASS: undefined }), 401, 'unauthorized');
  expect(await env.DB.prepare("SELECT id FROM labels WHERE id = 'label-m'").first()).not.toBeNull();
  expect(await labelIds()).toEqual([]);
  expect(await changes()).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

async function updatedAt(id = 'place-1') {
  return (await env.DB.prepare('SELECT updated_at FROM places WHERE id = ?').bind(id).first<{ updated_at: string }>())!.updated_at;
}

it('実際に変わったときだけ places.updated_at を更新する', async () => {
  const initial = '2026-11-24T00:00:00.000Z';
  const now = '2026-11-24T05:00:00.000Z';
  const at = (method: string) => requestWithEnv(path, { method }, { ...(env as never as typeof env), ACCESS_BYPASS: 'true', NOW: now });
  await expectNoContent(await at('DELETE'));
  expect(await updatedAt()).toBe(initial);
  await expectNoContent(await at('PUT'));
  expect(await updatedAt()).toBe(now);
  await env.DB.prepare('UPDATE places SET updated_at = ?').bind(initial).run();
  await expectNoContent(await at('PUT'));
  expect(await updatedAt()).toBe(initial);
  await expectNoContent(await at('DELETE'));
  expect(await updatedAt()).toBe(now);
  expect(await updatedAt('place-2')).toBe(initial);
});

for (const method of ['PUT', 'DELETE']) {
  it(`${method}: 存在確認のあとに種類が消えたら外部キー違反ではなく 404 label_not_found`, async () => {
    const batch = env.DB.batch.bind(env.DB);
    // Commit the deletion first, so it survives the failed batch's rollback.
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async statements => {
      await env.DB.prepare("DELETE FROM labels WHERE id = 'label-m'").run();
      return batch(statements);
    });
    const response = await requestAsOperator(path, { method });
    if (method === 'PUT') await expectProblem(response, 404, 'label_not_found');
    else await expectNoContent(response);
    expect(await changes()).toEqual([]);
  });

  it(`${method}: 存在確認のあとに場所が消えたら 404 not_found`, async () => {
    const batch = env.DB.batch.bind(env.DB);
    // Commit the deletion first, so it survives the failed batch's rollback.
    vi.spyOn(env.DB, 'batch').mockImplementationOnce(async statements => {
      await env.DB.prepare("DELETE FROM places WHERE id = 'place-1'").run();
      return batch(statements);
    });
    const response = await requestAsOperator(path, { method });
    if (method === 'PUT') await expectProblem(response, 404, 'not_found');
    else await expectNoContent(response);
  });
}
