import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import type { components } from '../src/schema';
import { normalize } from '../src/lib/normalize';
import { migrateTestDb, request } from './helpers';

type Place = components['schemas']['Place'];

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM place_labels'),
    env.DB.prepare('DELETE FROM place_hours'),
    env.DB.prepare('DELETE FROM places'),
    env.DB.prepare('DELETE FROM labels'),
    env.DB.prepare('DELETE FROM landmarks'),
  ]);
});

function placeStatement(id: string, name: string, kind: Place['kind'] = 'event') {
  return env.DB.prepare(`
    INSERT INTO places (id, name, kind, lat, lng, description, search_text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, name, kind, 37.4249, 138.7781, '', normalize(name), '2026-11-28T00:00:00.000Z');
}

async function search(q: string): Promise<{ items: Place[] }> {
  const response = await request(`/api/places/search?${new URLSearchParams({ q })}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  const body = await response.json() as { items: Place[] };
  expect(Object.keys(body)).toEqual(['items']);
  return body;
}

it.each(['abc', 'AbC', 'ＡＢＣ', 'ａｂｃ'])(
  '検索語 %s は名前の全角・半角と英字の大小を吸収する', async q => {
    await env.DB.batch([
      placeStatement('fullwidth', '北ＡｂＣ屋台'),
      placeStatement('ascii', '南aBc屋台'),
      placeStatement('other', '別の屋台'),
    ]);
    expect((await search(q)).items.map(place => place.id)).toEqual(['fullwidth', 'ascii']);
  },
);

it.each(['フード', 'ﾌｰﾄﾞ'])('検索語 %s はカタカナの全角・半角を吸収する', async q => {
  await env.DB.batch([
    placeStatement('fullwidth', 'フード屋台'),
    placeStatement('halfwidth', 'ﾌｰﾄﾞ屋台'),
  ]);
  expect((await search(q)).items.map(place => place.id).sort()).toEqual(['fullwidth', 'halfwidth']);
});

it.each([
  ['%', '100%屋台', '1000屋台'],
  ['％', '100%屋台', '1000屋台'],
  ['_', 'A_B屋台', 'ACB屋台'],
  ['＿', 'A_B屋台', 'ACB屋台'],
  ['\\', 'A\\B屋台', 'AB屋台'],
  ['%_\\', 'A%_\\B屋台', 'AXYB屋台'],
  ["' OR 1=1 --", "A' OR 1=1 --B屋台", '別の屋台'],
])('特殊文字を含む %s はリテラルとして検索する', async (q, name, other) => {
  await env.DB.batch([
    placeStatement('match', name),
    placeStatement('other', other),
  ]);
  expect((await search(q)).items.map(place => place.id)).toEqual(['match']);
});

it('一致する場所がなければ items だけの空配列を返す', async () => {
  await placeStatement('event', '焼きそば屋台').run();
  expect(await search('たこ焼き')).toEqual({ items: [] });
});

it('場所が0件でも空配列を返す', async () => {
  expect(await search('屋台')).toEqual({ items: [] });
});

it('名前に一致した企画と駐車場だけを返し、全種類の設備を除外する', async () => {
  const kinds: Place['kind'][] = ['event', 'parking', 'info', 'wc', 'rest', 'trash'];
  await env.DB.batch(kinds.map(kind => placeStatement(kind, '検索対象', kind)));
  expect((await search('検索')).items.map(place => place.id)).toEqual(['event', 'parking']);
});

it('設備だけが一致する場合も空配列を返す', async () => {
  await placeStatement('wc', 'トイレ', 'wc').run();
  expect(await search('トイレ')).toEqual({ items: [] });
});

it('説明だけの一致は検索結果に含めない', async () => {
  await placeStatement('event', '模擬店').run();
  await env.DB.prepare('UPDATE places SET description = ? WHERE id = ?').bind('焼きそば', 'event').run();
  expect(await search('焼きそば')).toEqual({ items: [] });
});

it.each([
  ['未指定', '/api/places/search'],
  ['空文字', '/api/places/search?q='],
  ['51文字', `/api/places/search?q=${'a'.repeat(51)}`],
  ['Unicodeの51文字', `/api/places/search?${new URLSearchParams({ q: '😀'.repeat(51) })}`],
])('q が%sなら field=q の400 problemを返す', async (_name, path) => {
  const response = await request(path);
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({
    code: 'invalid_input', message: expect.any(String), field: 'q',
  });
});

it.each(['a', 'a'.repeat(50), '😀'.repeat(50), '㍿'.repeat(50)])(
  'q の長さの境界と正規化前の文字数を受け入れる (%s)', async q => {
    await placeStatement('boundary', q).run();
    expect((await search(q)).items.map(place => place.id)).toEqual(['boundary']);
  },
);

it('name、id の順で返し、各場所の開催時間とラベルを整列して返す', async () => {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO landmarks (id, name, lat, lng) VALUES (?, ?, ?, ?)')
      .bind('building', '講義棟', 37.4249, 138.7781),
    placeStatement('z', 'B屋台', 'parking'),
    placeStatement('b', 'A屋台'),
    placeStatement('a', 'A屋台'),
    placeStatement('unmatched', '対象外'),
    env.DB.prepare('UPDATE places SET landmark_id = ?, floor = ?, description = ? WHERE id = ?')
      .bind('building', 2, '2年生の模擬店', 'a'),
    env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?), (?, ?)')
      .bind('label-z', '展示', 'label-a', '飲食'),
    env.DB.prepare('INSERT INTO place_labels (place_id, label_id) VALUES (?, ?), (?, ?), (?, ?), (?, ?)')
      .bind('a', 'label-z', 'a', 'label-a', 'b', 'label-z', 'unmatched', 'label-a'),
    env.DB.prepare('INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)')
      .bind(
        'a', '2026-11-28T04:00:00.000Z', '2026-11-28T06:00:00.000Z',
        'a', '2026-11-28T01:00:00.000Z', '2026-11-28T03:00:00.000Z',
        'b', '2026-11-29T01:00:00.000Z', '2026-11-29T03:00:00.000Z',
        'unmatched', '2026-11-28T00:00:00.000Z', '2026-11-28T07:00:00.000Z',
      ),
  ]);

  const common = { location: { lat: 37.4249, lng: 138.7781 }, description: '', landmarkId: null, floor: null };
  expect(await search('屋台')).toEqual({
    items: [
      {
        ...common, id: 'a', name: 'A屋台', kind: 'event', description: '2年生の模擬店', landmarkId: 'building', floor: 2,
        hours: [
          { start: '2026-11-28T01:00:00.000Z', end: '2026-11-28T03:00:00.000Z' },
          { start: '2026-11-28T04:00:00.000Z', end: '2026-11-28T06:00:00.000Z' },
        ],
        labelIds: ['label-a', 'label-z'],
      },
      {
        ...common, id: 'b', name: 'A屋台', kind: 'event',
        hours: [{ start: '2026-11-29T01:00:00.000Z', end: '2026-11-29T03:00:00.000Z' }],
        labelIds: ['label-z'],
      },
      { ...common, id: 'z', name: 'B屋台', kind: 'parking', hours: [], labelIds: [] },
    ],
  });
});

it('多数の一致でも切り捨てず関連データと一緒に全件返す', async () => {
  const ids = Array.from({ length: 120 }, (_, i) => `place-${String(i).padStart(3, '0')}`);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?)').bind('food', '飲食'),
    ...ids.flatMap(id => [
      placeStatement(id, '屋台'),
      env.DB.prepare('INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?)')
        .bind(id, '2026-11-28T01:00:00.000Z', '2026-11-28T03:00:00.000Z'),
      env.DB.prepare('INSERT INTO place_labels (place_id, label_id) VALUES (?, ?)').bind(id, 'food'),
    ]),
  ]);
  const { items } = await search('屋台');
  expect(items.map(place => place.id)).toEqual(ids);
  for (const place of items) {
    expect(place.hours).toEqual([{ start: '2026-11-28T01:00:00.000Z', end: '2026-11-28T03:00:00.000Z' }]);
    expect(place.labelIds).toEqual(['food']);
  }
});
