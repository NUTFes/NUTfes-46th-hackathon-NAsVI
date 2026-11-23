import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stamp } from '../types';
import {
  cacheKeys, loadSnapshot, pickCursor, saveSnapshot, setCacheStore,
  type CacheEntry, type CacheKey, type CacheStore, type Snapshot,
} from './cache';

const options = { now: () => new Date('2026-11-28T02:00:00Z') };
const snapshot: Snapshot = {
  places: [], stamps: [], landmarks: [],
  labels: [{ id: 'lb_food', title: '飲食' }], cursor: '9',
  cursors: { places: '10', stamps: '9', landmarks: '12', labels: '13' },
};
const stamp: Stamp = {
  id: 'st_fun', kind: 'fun', at: { lat: 37.4252, lng: 138.7788 },
  pressedAt: '2026-11-28T01:00:00Z', expiresAt: '2026-11-28T03:00:00Z',
};
type Entries = { [K in CacheKey]?: CacheEntry<K> };

function entriesFor(saved = snapshot): Entries {
  return Object.fromEntries(cacheKeys.map((key) => [key, {
    value: structuredClone(saved[key]), cursor: saved.cursors[key],
  }])) as Entries;
}

function useEntries(entries: Entries): CacheStore {
  const store: CacheStore = {
    async get(key) { return entries[key]; },
    async set(key, entry) { Object.assign(entries, { [key]: structuredClone(entry) }); },
  };
  setCacheStore(store);
  return store;
}

function withoutKey(key: CacheKey): Snapshot {
  const expected = structuredClone(snapshot);
  Object.assign(expected, { [key]: [] });
  expected.cursors[key] = null;
  expected.cursor = pickCursor(expected.cursors.places, expected.cursors.stamps);
  return expected;
}

beforeEach(() => setCacheStore());
afterEach(() => setCacheStore());

describe('snapshot の保存と読み出し', () => {
  it('未保存なら null を返す', async () => {
    await expect(loadSnapshot(options)).resolves.toBeNull();
  });

  it('空の一覧とキーごとの cursor を保存し、places/stamps の小さい方を返す', async () => {
    await saveSnapshot(snapshot, options);
    await expect(loadSnapshot(options)).resolves.toEqual(snapshot);
  });

  it('メモリ保存後や読み出し後の変更は、保存済みの値に影響しない', async () => {
    const saved = structuredClone(snapshot);
    await saveSnapshot(saved, options);
    saved.labels[0].title = '保存後の変更';
    saved.cursors.places = '100';
    const loaded = await loadSnapshot(options);
    expect(loaded).toEqual(snapshot);
    loaded!.labels[0].title = '読み出し後の変更';
    loaded!.cursors.stamps = '100';
    await expect(loadSnapshot(options)).resolves.toEqual(snapshot);
  });

  it('保存先には Snapshot.cursor ではなくキーごとの cursor を渡す', async () => {
    const store = useEntries({});
    const set = vi.spyOn(store, 'set');
    await saveSnapshot(snapshot, options);
    expect(set).toHaveBeenCalledTimes(4);
    for (const key of cacheKeys) {
      expect(set).toHaveBeenCalledWith(key, { value: snapshot[key], cursor: snapshot.cursors[key] });
    }
  });

  it.each(cacheKeys)('%s が未保存でも、ほかのキーを返す', async (key) => {
    const entries = entriesFor();
    delete entries[key];
    useEntries(entries);
    await expect(loadSnapshot(options)).resolves.toEqual(withoutKey(key));
  });

  it.each(cacheKeys)('%s の get が同期的に例外を投げてもほかを返す', async (key) => {
    const entries = entriesFor();
    setCacheStore({
      get(requested) {
        if (requested === key) throw new Error('broken cache');
        return Promise.resolve(entries[requested]);
      },
      async set() {},
    });
    await expect(loadSnapshot(options)).resolves.toEqual(withoutKey(key));
  });

  it('get の Promise が reject しても、読めたキーを返す', async () => {
    const entries = entriesFor();
    setCacheStore({
      async get(key) {
        if (key === 'labels') throw new Error('read failed');
        return entries[key];
      },
      async set() {},
    });
    await expect(loadSnapshot(options)).resolves.toEqual(withoutKey('labels'));
  });

  it.each(cacheKeys)('%s の壊れた値だけを捨てる', async (key) => {
    for (const broken of [null, {}, { value: null }, { value: '[]' }, { value: {}, cursor: '8' }]) {
      const entries = entriesFor();
      Object.assign(entries, { [key]: broken });
      useEntries(entries);
      await expect(loadSnapshot(options)).resolves.toEqual(withoutKey(key));
    }
  });

  it('すべてのキーが壊れていれば null を返す', async () => {
    setCacheStore({ async get() { throw new Error('read failed'); }, async set() {} });
    await expect(loadSnapshot(options)).resolves.toBeNull();
  });

  it.each(cacheKeys)('%s の set の例外だけを無視し、ほかを保存する', async (key) => {
    const entries: Entries = {};
    setCacheStore({
      async get(requested) { return entries[requested]; },
      set(requested, entry) {
        if (requested === key) throw new Error('write failed');
        Object.assign(entries, { [requested]: entry });
        return Promise.resolve();
      },
    });
    await expect(saveSnapshot(snapshot, options)).resolves.toBeUndefined();
    await expect(loadSnapshot(options)).resolves.toEqual(withoutKey(key));
  });

  it('set の Promise が reject しても、ほかを保存する', async () => {
    const entries: Entries = {};
    const store = useEntries(entries);
    const set = store.set.bind(store);
    store.set = async (key, entry) => {
      if (key === 'labels') throw new Error('write failed');
      await set(key, entry);
    };
    await saveSnapshot(snapshot, options);
    await expect(loadSnapshot(options)).resolves.toEqual(withoutKey('labels'));
  });

  it('保存時にも壊れた一覧はそのキーだけを捨てる', async () => {
    const saved = { ...snapshot, places: null } as unknown as Snapshot;
    await expect(saveSnapshot(saved, options)).resolves.toBeUndefined();
    await expect(loadSnapshot(options)).resolves.toEqual(withoutKey('places'));
  });

  it.each(['places', 'stamps'] as const)('%s の cursor が欠ける・不正なら一覧を保って cursor=null にする', async (key) => {
    for (const cursor of [undefined, null, '', 'invalid', '1.5', '1e3', 9, {}]) {
      const entries = entriesFor();
      Object.assign(entries[key]!, { cursor });
      useEntries(entries);
      const expected = { ...snapshot, cursor: null, cursors: { ...snapshot.cursors, [key]: null } };
      await expect(loadSnapshot(options)).resolves.toEqual(expected);
    }
  });
});

describe('スタンプの期限', () => {
  const expired = { ...stamp, id: 'expired', expiresAt: '2026-11-28T01:59:59Z' };
  const boundary = { ...stamp, id: 'boundary', expiresAt: '2026-11-28T02:00:00Z' };

  it('保存時に期限切れと期限ちょうどを除き、入力は変更しない', async () => {
    const saved = { ...snapshot, stamps: [expired, boundary, stamp] };
    const store = useEntries({});
    const set = vi.spyOn(store, 'set');
    await saveSnapshot(saved, options);
    expect(set).toHaveBeenCalledWith('stamps', { value: [stamp], cursor: '9' });
    expect(saved.stamps).toHaveLength(3);
  });

  it('読み出し時も注入した現在時刻で除き、元の値は変更しない', async () => {
    const entries = entriesFor({ ...snapshot, stamps: [expired, boundary, stamp] });
    useEntries(entries);
    await expect(loadSnapshot(options)).resolves.toEqual({ ...snapshot, stamps: [stamp] });
    await expect(loadSnapshot({ now: () => Date.parse(stamp.expiresAt) })).resolves.toEqual(snapshot);
    expect(entries.stamps!.value).toHaveLength(3);
  });

  it.each([null, {}, { expiresAt: 'invalid' }])('スタンプ要素が壊れていても、ほかのキーを返す: %s', async (broken) => {
    const entries = entriesFor();
    Object.assign(entries, { stamps: { value: [broken], cursor: '9' } });
    useEntries(entries);
    await expect(loadSnapshot(options)).resolves.toEqual(withoutKey('stamps'));
  });
});

describe('pickCursor', () => {
  it.each([
    ['9', '10', '9'], ['10', '9', '9'], ['10', '10', '10'], ['0', '10', '0'],
    ['9007199254740993', '9007199254740992', '9007199254740992'],
    ['9007199254740992', '9007199254740993', '9007199254740992'],
    ['10', undefined, null], [undefined, '10', null], ['10', null, null], [null, '10', null],
    [undefined, undefined, null], [null, null, null], ['', '10', null],
    ['10', 'invalid', null], ['1.5', '10', null], ['1e3', '10', null],
  ])('places=%s, stamps=%s → %s', (places, stamps, expected) => {
    expect(pickCursor(places, stamps)).toBe(expected);
  });
});
