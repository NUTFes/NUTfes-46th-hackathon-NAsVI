import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '../src/schema';
import { migrateTestDb, requestWithEnv } from './helpers';

const now = '2026-11-24T02:00:00.000Z';
const pressedAt = '2026-11-24T01:45:00.000Z';
const expiresAt = '2026-11-24T02:15:00.000Z';
const kinds: components['schemas']['StampKind'][] = [
  'congestion-1', 'congestion-2', 'congestion-3', 'congestion-4', 'congestion-5', 'fun', 'food', 'good',
];

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM stamps'), env.DB.prepare('DELETE FROM changes')]);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

async function seedStamp(id: string, kind: components['schemas']['StampKind'] = 'fun', expiry = expiresAt) {
  await env.DB.prepare(`INSERT INTO stamps (id, kind, lat, lng, pressed_at, expires_at, proof_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, kind, 37.425, 138.7783, pressedAt, expiry, 'private-proof-hash').run();
}

function list() {
  return requestWithEnv('/api/stamps', {}, { ...env, NOW: now });
}

it('認証なしで空の一覧と文字列の cursor 0 を返す', async () => {
  const response = await list();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ items: [], cursor: '0' });
});

it('全8種類を OpenAPI の Stamp の形で返し、proof・proof_hash・by を含めない', async () => {
  for (const [index, kind] of kinds.entries()) await seedStamp(`stamp-${index}`, kind);
  const response = await list();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    items: kinds.map((kind, index) => ({
      id: `stamp-${index}`, kind, at: { lat: 37.425, lng: 138.7783 }, pressedAt, expiresAt,
    })),
    cursor: '0',
  });
});

it('期限が過去・現在と同じものを除き、1ms後のものは返す', async () => {
  await seedStamp('expired', 'congestion-3', '2026-11-24T01:59:59.999Z');
  await seedStamp('boundary', 'food', now);
  await seedStamp('active', 'good', '2026-11-24T02:00:00.001Z');
  const response = await list();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    items: [{ id: 'active', kind: 'good', at: { lat: 37.425, lng: 138.7783 }, pressedAt, expiresAt: '2026-11-24T02:00:00.001Z' }],
    cursor: '0',
  });
  // Listing only filters; it does not delete expired rows or create events.
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM stamps').first('n')).toBe(3);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM changes').first('n')).toBe(0);
});

it.each([false, true])('一覧が空(%s)でも changes 全体の最大 id を cursor にする', async empty => {
  await seedStamp('stamp', 'fun', empty ? now : expiresAt);
  const result = await env.DB.prepare('INSERT INTO changes (type, payload, created_at) VALUES (?, ?, ?)')
    .bind('placeRemoved', JSON.stringify({ id: 'place' }), now).run();
  const response = await list();
  const body = await response.json() as components['schemas']['StampList'];
  expect(response.status).toBe(200);
  expect(body.cursor).toBe(String(result.meta.last_row_id));
  expect(body.items).toHaveLength(empty ? 0 : 1);
});

it('一覧と cursor を1回の読み取り batch で取得する', async () => {
  await seedStamp('stamp');
  const batch = vi.spyOn(env.DB, 'batch');
  const response = await list();
  expect(response.status).toBe(200);
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(2);
});

it('DB の失敗は OpenAPI の 500 problem+json で返す', async () => {
  vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('database unavailable'));
  const response = await list();
  expect(response.status).toBe(500);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'internal_error', message: expect.any(String) });
});
