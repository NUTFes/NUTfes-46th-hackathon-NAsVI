import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { migrateTestDb, requestWithEnv } from './helpers';

const now = '2026-11-24T02:00:00.000Z';
// Known SHA-256 test vector; independent of the route's hash implementation.
const proof = 'abc';
const proofHash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const publish = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
const hub = {
  idFromName: vi.fn(() => 'main-id'), get: vi.fn(() => ({ fetch: publish })),
} as unknown as Env['HUB'];

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await env.DB.batch([env.DB.prepare('DELETE FROM stamps'), env.DB.prepare('DELETE FROM changes')]);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

async function seedStamp(id = 'stamp', hash = proofHash, expiry = '2026-11-24T02:15:00.000Z') {
  await env.DB.prepare(`INSERT INTO stamps (id, kind, lat, lng, pressed_at, expires_at, proof_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, 'fun', 37.425, 138.7783, '2026-11-24T01:45:00.000Z', expiry, hash).run();
}

function retract(id = 'stamp', value = proof) {
  return requestWithEnv(`/api/stamps/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'X-Stamp-Proof': value },
  }, { ...env, NOW: now, HUB: hub });
}

async function expectProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code, message: expect.any(String) });
}

async function expectUnchanged() {
  expect(await env.DB.prepare('SELECT proof_hash FROM stamps WHERE id = ?').bind('stamp').first('proof_hash')).toBe(proofHash);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
  expect(publish).not.toHaveBeenCalled();
}

it('証が一致したら対象だけを削除し、204 と stampRetracted を返す', async () => {
  await seedStamp();
  await seedStamp('other');
  const batch = vi.spyOn(env.DB, 'batch');
  const response = await retract();
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(2);
  expect(await env.DB.prepare('SELECT id FROM stamps').all()).toMatchObject({ results: [{ id: 'other' }] });
  const change = await env.DB.prepare('SELECT * FROM changes').first<{ id: number; type: string; payload: string; created_at: string }>();
  expect(change).toEqual({ id: expect.any(Number), type: 'stampRetracted', payload: JSON.stringify({ id: 'stamp' }), created_at: now });
  expect(hub.idFromName).toHaveBeenCalledWith('main');
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toBe('http://hub/publish');
  expect(publish.mock.calls[0][1]?.method).toBe('POST');
  expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({
    id: change!.id, type: 'stampRetracted', payload: { id: 'stamp' }, createdAt: now,
  });
});

it.each(['abd', proofHash, 'ABC', ''])('証 %s が一致しなければ 403 で変更しない', async value => {
  await seedStamp();
  await expectProblem(await retract('stamp', value), 403, 'not_stamp_owner');
  await expectUnchanged();
});

it('証ヘッダーがなければ 403 で変更しない', async () => {
  await seedStamp();
  const response = await requestWithEnv('/api/stamps/stamp', { method: 'DELETE' }, { ...env, NOW: now, HUB: hub });
  await expectProblem(response, 403, 'not_stamp_owner');
  await expectUnchanged();
});

it('同じ長さのハッシュを Workers の定数時間比較に渡す', async () => {
  await seedStamp();
  const compare = vi.spyOn(crypto.subtle, 'timingSafeEqual');
  expect((await retract()).status).toBe(204);
  const bytes = new TextEncoder().encode(proofHash);
  expect(compare).toHaveBeenCalledExactlyOnceWith(bytes, bytes);
});

it('存在しない id は 404 で、他のスタンプと履歴を変更しない', async () => {
  await seedStamp();
  await expectProblem(await retract("missing' OR 1=1 --"), 404, 'not_found');
  await expectUnchanged();
});

it('取り消し済みの id は 404 で、出来事を重ねて記録しない', async () => {
  await seedStamp();
  expect((await retract()).status).toBe(204);
  await expectProblem(await retract(), 404, 'not_found');
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(1);
  expect(publish).toHaveBeenCalledTimes(1);
});

it('期限切れのスタンプは証が一致すれば行を消して 204 を返すが、stampRetracted は流さない', async () => {
  await seedStamp('stamp', proofHash, now);
  expect((await retract()).status).toBe(204);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM stamps').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
  expect(publish).not.toHaveBeenCalled();
});

it('同じ id への並行 DELETE でも stampRetracted は 1 回だけ記録される', async () => {
  await seedStamp();
  const statuses = (await Promise.all([retract(), retract(), retract()])).map(r => r.status).sort();
  expect(statuses).toEqual([204, 404, 404]);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(1);
  expect(publish).toHaveBeenCalledTimes(1);
});

it('履歴の保存が失敗したら削除もロールバックし、500 を返す', async () => {
  await seedStamp();
  await env.DB.prepare(`CREATE TRIGGER reject_stamp_retraction BEFORE INSERT ON changes
    WHEN NEW.type = 'stampRetracted' BEGIN SELECT RAISE(ABORT, 'test failure'); END`).run();
  try {
    await expectProblem(await retract(), 500, 'internal_error');
    await expectUnchanged();
  } finally {
    await env.DB.exec('DROP TRIGGER reject_stamp_retraction');
  }
});

it('Hub の配信が失敗しても削除と履歴が保存されていれば 204', async () => {
  await seedStamp();
  publish.mockRejectedValueOnce(new Error('publish failed'));
  expect((await retract()).status).toBe(204);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM stamps').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT payload FROM changes').first('payload')).toBe(JSON.stringify({ id: 'stamp' }));
});
