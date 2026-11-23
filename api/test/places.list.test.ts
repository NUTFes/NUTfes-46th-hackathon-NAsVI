import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '../src/schema';
import { migrateTestDb, request, requestWithEnv } from './helpers';

type Place = components['schemas']['Place'];
const now = '2026-11-28T01:00:00.000Z';
const morning = { start: now, end: '2026-11-28T03:00:00.000Z' };
const afternoon = { start: '2026-11-28T04:00:00.000Z', end: '2026-11-28T07:00:00.000Z' };

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: 'pl_event', name: '焼きそば屋台', kind: 'event',
    location: { lat: 37.4249, lng: 138.7781 }, description: '2 年生の模擬店',
    landmarkId: null, floor: null, hours: [], labelIds: [], ...overrides,
  };
}

async function insertPlace(value: Place): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO places
      (id, name, kind, lat, lng, description, search_text, landmark_id, floor, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(value.id, value.name, value.kind, value.location.lat, value.location.lng,
        value.description, value.name.normalize('NFKC').toLowerCase(), value.landmarkId, value.floor, now),
    ...value.hours.map(hours => env.DB.prepare('INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?)')
      .bind(value.id, hours.start, hours.end)),
    ...value.labelIds.map(id => env.DB.prepare('INSERT INTO place_labels (place_id, label_id) VALUES (?, ?)')
      .bind(value.id, id)),
  ]);
}

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM place_labels'), env.DB.prepare('DELETE FROM place_hours'),
    env.DB.prepare('DELETE FROM places'), env.DB.prepare('DELETE FROM labels'),
    env.DB.prepare('DELETE FROM landmarks'), env.DB.prepare('DELETE FROM changes'),
  ]);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

it('場所も履歴も 0 件なら認証なしで 200 と空の PlaceList・cursor 0 を返す', async () => {
  const response = await request('/api/places');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ items: [], cursor: '0' });
});

it('全種別の複数の場所を OpenAPI の PlaceList の形で返す', async () => {
  await env.DB.prepare('INSERT INTO landmarks (id, name, lat, lng) VALUES (?, ?, ?, ?)')
    .bind('lm_a', 'A 棟', 37.4246, 138.7779).run();
  const kinds: Place['kind'][] = ['event', 'parking', 'info', 'wc', 'rest', 'trash'];
  const items = kinds.map(kind => place({
    id: `pl_${kind}`, name: kind, kind, description: '',
    ...(kind === 'event' ? { landmarkId: 'lm_a', floor: -1 } : {}),
    ...(kind === 'info' ? { landmarkId: 'lm_a', floor: null } : {}),
  }));
  for (const item of items) await insertPlace(item);
  const response = await request('/api/places');
  expect(response.status).toBe(200);
  const body = await response.json() as components['schemas']['PlaceList'];
  expect(body).toEqual({ items: expect.arrayContaining(items), cursor: '0' });
  expect(body.items).toHaveLength(items.length);
});

it('複数の時間帯と運営の種類を重複させず、場所ごとに結び付ける', async () => {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?)').bind('lb_food', '飲食'),
    env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?)').bind('lb_show', '展示'),
  ]);
  const first = place({ hours: [morning, afternoon], labelIds: ['lb_food', 'lb_show'] });
  const second = place({ id: 'pl_other', name: '展示', hours: [afternoon], labelIds: ['lb_show'] });
  const empty = place({ id: 'pl_empty', name: '時間帯・種類なし' });
  // Insert hours in reverse order to ensure start/end pairs survive assembly.
  await insertPlace({ ...first, hours: [afternoon, morning] });
  await insertPlace(second);
  await insertPlace(empty);
  const response = await request('/api/places');
  expect(response.status).toBe(200);
  const body = await response.json() as components['schemas']['PlaceList'];
  expect(body).toEqual({ items: expect.arrayContaining([first, second, empty]), cursor: '0' });
  expect(body.items).toHaveLength(3);
});

it('cursor は場所に関係しない変更も含めた changes の最大 id の文字列になる', async () => {
  const item = place();
  await insertPlace(item);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO changes (id, type, payload, created_at) VALUES (?, ?, ?, ?)')
      .bind(17, 'appVersionChanged', '{"version":"2"}', now),
    env.DB.prepare('INSERT INTO changes (id, type, payload, created_at) VALUES (?, ?, ?, ?)')
      .bind(3, 'placeAdded', JSON.stringify(item), now),
    env.DB.prepare('INSERT INTO changes (id, type, payload, created_at) VALUES (?, ?, ?, ?)')
      .bind(9, 'stampRetracted', '{"id":"stamp_old"}', now),
  ]);
  const maxId = await env.DB.prepare('SELECT MAX(id) AS id FROM changes').first<number>('id');
  const response = await request('/api/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [item], cursor: String(maxId) });
  expect(maxId).toBe(17);
});

it('場所が 0 件でも履歴があれば 200 とその最大 id を返す', async () => {
  await env.DB.prepare('INSERT INTO changes (id, type, payload, created_at) VALUES (?, ?, ?, ?)')
    .bind(42, 'placeRemoved', '{"id":"pl_removed"}', now).run();
  const response = await request('/api/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [], cursor: '42' });
});

it('一覧を読んだ直後に更新されても時間帯・種類・cursor は同じ時点の値を返す', async () => {
  await env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?)').bind('lb_food', '飲食').run();
  const item = place({ hours: [morning], labelIds: ['lb_food'] });
  await insertPlace(item);
  const originalBatch = env.DB.batch.bind(env.DB);
  const batch = vi.spyOn(env.DB, 'batch').mockImplementationOnce(async statements => {
    const snapshot = await originalBatch(statements);
    await originalBatch([
      env.DB.prepare('UPDATE places SET name = ? WHERE id = ?').bind('更新後', item.id),
      env.DB.prepare('DELETE FROM place_hours WHERE place_id = ?').bind(item.id),
      env.DB.prepare('DELETE FROM place_labels WHERE place_id = ?').bind(item.id),
      env.DB.prepare('INSERT INTO changes (id, type, payload, created_at) VALUES (?, ?, ?, ?)')
        .bind(23, 'placeUpdated', '{"id":"pl_event","name":"更新後"}', now),
    ]);
    return snapshot;
  });
  const response = await requestWithEnv('/api/places');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [item], cursor: '0' });
  expect(batch).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare('SELECT name FROM places WHERE id = ?').bind(item.id).first('name')).toBe('更新後');
  expect(await env.DB.prepare('SELECT MAX(id) AS id FROM changes').first('id')).toBe(23);
});

it('D1 の読み取りが失敗したら 500 problem+json を返す', async () => {
  vi.spyOn(env.DB, 'batch').mockRejectedValueOnce(new Error('database failed'));
  const response = await requestWithEnv('/api/places');
  expect(response.status).toBe(500);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'internal_error', message: expect.any(String) });
});
