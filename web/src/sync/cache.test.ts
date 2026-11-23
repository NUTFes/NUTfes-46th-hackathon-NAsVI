import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSnapshot, pickCursor, saveSnapshot, setCacheStore,
  type CacheEntry, type CacheKey, type CacheStore, type Snapshot,
} from './cache';

const snapshot: Snapshot = {
  places: [], stamps: [], landmarks: [],
  labels: [{ id: 'lb_food', title: '飲食' }], cursor: '9',
};

beforeEach(() => setCacheStore());
afterEach(() => setCacheStore());

describe('snapshot の保存と読み出し', () => {
  it('未保存なら null を返す', async () => {
    await expect(loadSnapshot()).resolves.toBeNull();
  });

  it.each(['9', null])('空の一覧も cursor=%s と一緒に保存できる', async (cursor) => {
    const saved = { ...snapshot, cursor };
    await saveSnapshot(saved);
    await expect(loadSnapshot()).resolves.toEqual(saved);
  });

  it('メモリ保存後や読み出し後の変更は、保存済みの値に影響しない', async () => {
    const saved = structuredClone(snapshot);
    await saveSnapshot(saved);
    saved.labels[0].title = '保存後の変更';
    const loaded = await loadSnapshot();
    expect(loaded).toEqual(snapshot);
    loaded!.labels[0].title = '読み出し後の変更';
    await expect(loadSnapshot()).resolves.toEqual(snapshot);
  });

  it('注入した保存先へ、4 つのキーごとに値と cursor を渡す', async () => {
    const store: CacheStore = {
      async get() { return undefined; },
      async set() {},
    };
    vi.spyOn(store, 'get');
    vi.spyOn(store, 'set');
    setCacheStore(store);
    await saveSnapshot(snapshot);

    expect(store.set).toHaveBeenCalledTimes(4);
    for (const key of ['places', 'stamps', 'landmarks', 'labels'] as const) {
      expect(store.set).toHaveBeenCalledWith(key, { value: snapshot[key], cursor: '9' });
    }
    await expect(loadSnapshot()).resolves.toBeNull();
    expect(store.get).toHaveBeenCalledTimes(4);
  });

  it.each<CacheKey>(['places', 'stamps', 'landmarks', 'labels'])(
    '%s が未保存の不完全なキャッシュは null を返す',
    async (missingKey) => {
      const entries: { [K in CacheKey]?: CacheEntry<K> } = {
        places: { value: [], cursor: '9' },
        stamps: { value: [], cursor: '10' },
        landmarks: { value: [], cursor: null },
        labels: { value: snapshot.labels, cursor: null },
      };
      delete entries[missingKey];
      setCacheStore({
        async get(key) { return entries[key]; },
        async set() {},
      });
      await expect(loadSnapshot()).resolves.toBeNull();
    },
  );

  it('注入した保存先の places と stamps でも古い cursor を使う', async () => {
    const entries: { [K in CacheKey]: CacheEntry<K> } = {
      places: { value: [], cursor: '10' },
      stamps: { value: [], cursor: '9' },
      landmarks: { value: [], cursor: null },
      labels: { value: snapshot.labels, cursor: null },
    };
    setCacheStore({
      async get(key) { return entries[key]; },
      async set() {},
    });
    await expect(loadSnapshot()).resolves.toEqual(snapshot);
  });
});

describe('pickCursor', () => {
  it.each([
    ['9', '10', '9'],
    ['10', '9', '9'],
    ['10', '10', '10'],
    ['0', '10', '0'],
    ['9007199254740993', '9007199254740992', '9007199254740992'],
    ['9007199254740992', '9007199254740993', '9007199254740992'],
    ['10', undefined, null],
    [undefined, '10', null],
    ['10', null, null],
    [null, '10', null],
    [undefined, undefined, null],
    [null, null, null],
    ['', '10', null],
    ['10', 'invalid', null],
    ['1.5', '10', null],
  ])('places=%s, stamps=%s → %s', (places, stamps, expected) => {
    expect(pickCursor(places, stamps)).toBe(expected);
  });
});
