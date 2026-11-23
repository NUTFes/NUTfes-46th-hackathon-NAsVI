import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { migrateTestDb, operatorEnv, requestWithEnv } from './helpers';

const now = '2026-11-24T02:00:00.000Z';
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
    env.DB.prepare('DELETE FROM places'), env.DB.prepare('DELETE FROM labels'),
    env.DB.prepare('DELETE FROM stamps'), env.DB.prepare('DELETE FROM changes'),
    ...['pl_01', 'pl_other'].map(id => env.DB.prepare(`INSERT INTO places
      (id, name, kind, lat, lng, description, search_text, updated_at)
      VALUES (?, '屋台', 'event', 37.425, 138.778, '', '屋台', ?)`).bind(id, now)),
    env.DB.prepare("INSERT INTO labels (id, title) VALUES ('lb_food', '飲食')"),
    ...['pl_01', 'pl_other'].flatMap(id => [
      env.DB.prepare('INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?)')
        .bind(id, '2026-11-28T01:00:00.000Z', '2026-11-28T03:00:00.000Z'),
      env.DB.prepare("INSERT INTO place_labels (place_id, label_id) VALUES (?, 'lb_food')").bind(id),
    ]),
    env.DB.prepare(`INSERT INTO stamps (id, kind, lat, lng, pressed_at, expires_at, proof_hash)
      VALUES ('st_01', 'food', 37.425, 138.778, ?, '2026-11-28T07:00:00.000Z', 'test-hash')`).bind(now),
  ]);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

function remove(id = 'pl_01') {
  return requestWithEnv(`/api/places/${id}`, { method: 'DELETE' }, bindings);
}
async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code, message: expect.any(String) });
}

it('削除・外部キーによる hours と labels の連動・履歴を 1 batch で確定し、204 を返す', async () => {
  const batch = vi.spyOn(env.DB, 'batch');
  const response = await remove();
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(response.headers.get('content-type')).toBeNull();
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(2);
  expect(await env.DB.prepare("SELECT * FROM places WHERE id = 'pl_01'").first()).toBeNull();
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM place_hours WHERE place_id = 'pl_01'").first('n')).toBe(0);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM place_labels WHERE place_id = 'pl_01'").first('n')).toBe(0);
  // Other places, label definitions, and stamps at the same point survive.
  expect(await env.DB.prepare("SELECT id FROM places WHERE id = 'pl_other'").first('id')).toBe('pl_other');
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM place_hours WHERE place_id = 'pl_other'").first('n')).toBe(1);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM place_labels WHERE place_id = 'pl_other'").first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT id FROM labels').first('id')).toBe('lb_food');
  expect(await env.DB.prepare('SELECT id FROM stamps').first('id')).toBe('st_01');
  const change = await env.DB.prepare('SELECT * FROM changes').first();
  expect(change).toEqual({ id: expect.any(Number), type: 'placeRemoved', payload: '{"id":"pl_01"}', created_at: now });
  expect(publish).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({
    id: change!.id, type: 'placeRemoved', payload: { id: 'pl_01' }, createdAt: now,
  });
});

it('存在しない id は 404 とし、batch と publish を呼ばない', async () => {
  const batch = vi.spyOn(env.DB, 'batch');
  await expectProblem(await remove('missing'), 404, 'not_found');
  expect(batch).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
  expect(publish).not.toHaveBeenCalled();
});

it('削除済み id を再度削除すると 404 とし、履歴を重複させない', async () => {
  expect((await remove()).status).toBe(204);
  await expectProblem(await remove(), 404, 'not_found');
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(1);
  expect(publish).toHaveBeenCalledTimes(1);
});

it('認証がない場合は 401 とし、データと履歴を変更しない', async () => {
  await expectProblem(await requestWithEnv('/api/places/pl_01', { method: 'DELETE' },
    { ...bindings, ACCESS_BYPASS: undefined }), 401, 'unauthorized');
  expect(await env.DB.prepare("SELECT id FROM places WHERE id = 'pl_01'").first('id')).toBe('pl_01');
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
  expect(publish).not.toHaveBeenCalled();
});

it('履歴の挿入が失敗すると場所・hours・labels の削除をロールバックし、500 problem を返す', async () => {
  await env.DB.exec("CREATE TRIGGER reject_place_delete_change BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    await expectProblem(await remove(), 500, 'internal_error');
    expect(await env.DB.prepare("SELECT id FROM places WHERE id = 'pl_01'").first('id')).toBe('pl_01');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM place_hours WHERE place_id = 'pl_01'").first('n')).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM place_labels WHERE place_id = 'pl_01'").first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  } finally {
    await env.DB.exec('DROP TRIGGER reject_place_delete_change');
  }
});
