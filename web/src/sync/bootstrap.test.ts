import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap, loadCachedOrFetch, retryBootstrap } from './bootstrap';
import {
  cacheKeys, loadSnapshot, pickCursor, saveSnapshot, setCacheStore,
  type CacheEntry, type CacheKey, type Snapshot,
} from './cache';

const fetchMock = vi.fn<typeof fetch>();
const options = { now: () => new Date('2026-11-28T02:00:00Z') };
const snapshot: Snapshot = {
  places: [{
    id: 'pl_food', name: '焼きそば屋台', kind: 'event',
    location: { lat: 37.4252, lng: 138.7788 }, description: '模擬店',
    landmarkId: null, floor: null, hours: [], labelIds: ['lb_food'],
  }],
  stamps: [{
    id: 'st_fun', kind: 'fun', at: { lat: 37.4252, lng: 138.7788 },
    pressedAt: '2026-11-28T01:00:00Z', expiresAt: '2026-11-28T07:00:00Z',
  }],
  landmarks: [{
    id: 'lm_a', name: 'A 棟', location: { lat: 37.4252, lng: 138.7788 },
    footprint: null, floors: [],
  }],
  labels: [{ id: 'lb_food', title: '飲食' }],
  cursor: '9',
  cursors: { places: '10', stamps: '9', landmarks: null, labels: null },
};
const empty: Snapshot = {
  places: [], stamps: [], landmarks: [], labels: [], cursor: null,
  cursors: { places: null, stamps: null, landmarks: null, labels: null },
};
const cached: Snapshot = {
  places: [{ ...snapshot.places[0], name: '古い場所' }],
  stamps: [{ ...snapshot.stamps[0], id: 'old_stamp' }],
  landmarks: [{ ...snapshot.landmarks[0], name: '古い建物' }],
  labels: [{ ...snapshot.labels[0], title: '古い種類' }],
  cursor: '1', cursors: { places: '1', stamps: '2', landmarks: '3', labels: '4' },
};

function responseFor(url: RequestInfo | URL, source = snapshot) {
  const key = cacheKeys.find((key) => url === `/api/${key}`);
  if (!key) throw new Error(`Unexpected request: ${url}`);
  return Response.json({ items: source[key], cursor: source.cursors[key] ?? undefined });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  setCacheStore();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) => responseFor(url));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_API_BASE', '');
});

afterEach(() => {
  setCacheStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('loadCachedOrFetch', () => {
  it('キャッシュが無ければ全件取得を待ち、保存した一覧を返す', async () => {
    const gate = deferred();
    fetchMock.mockImplementation(async (url) => {
      await gate.promise;
      return responseFor(url);
    });
    const settled = vi.fn();
    const pending = loadCachedOrFetch(options);
    void pending.then(settled);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(settled).not.toHaveBeenCalled();
    await expect(loadSnapshot(options)).resolves.toBeNull();
    gate.resolve();
    const result = await pending;
    expect(result.snapshot).toEqual(snapshot);
    await expect(result.updated).resolves.toEqual({ snapshot, failedKeys: [] });
    await expect(loadSnapshot(options)).resolves.toEqual(snapshot);
    for (const key of cacheKeys) {
      expect(fetchMock).toHaveBeenCalledWith(`/api/${key}`, {
        method: 'GET', headers: expect.any(Headers), body: undefined,
      });
    }
  });

  it('キャッシュを先に返し、裏で取得した成功結果で差し替えられる', async () => {
    await saveSnapshot(cached, options);
    const gate = deferred();
    fetchMock.mockImplementation(async (url) => {
      await gate.promise;
      return responseFor(url);
    });
    const result = await loadCachedOrFetch(options);
    expect(result.snapshot).toEqual(cached);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await expect(loadSnapshot(options)).resolves.toEqual(cached);
    const updated = vi.fn();
    void result.updated.then(updated);
    expect(updated).not.toHaveBeenCalled();
    gate.resolve();
    await expect(result.updated).resolves.toEqual({ snapshot, failedKeys: [] });
    await expect(loadSnapshot(options)).resolves.toEqual(snapshot);
  });

  it('オフラインで更新に失敗してもキャッシュを使い続ける', async () => {
    await saveSnapshot(cached, options);
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const result = await loadCachedOrFetch(options);
    expect(result.snapshot).toEqual(cached);
    await expect(result.updated).resolves.toEqual({ snapshot: cached, failedKeys: cacheKeys });
    await expect(loadSnapshot(options)).resolves.toEqual(cached);
  });

  it('キャッシュ無しで全件失敗しても、再試行用のキーを返す', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const result = await loadCachedOrFetch(options);
    expect(result.snapshot).toEqual(empty);
    await expect(result.updated).resolves.toEqual({ snapshot: empty, failedKeys: cacheKeys });
    await expect(loadSnapshot(options)).resolves.toBeNull();
  });

  it('一部だけ読めるキャッシュも先に返し、残りを全件取得する', async () => {
    setCacheStore({
      async get(key) { return key === 'labels' ? { value: snapshot.labels, cursor: null } as CacheEntry<typeof key> : undefined; },
      async set() {},
    });
    const gate = deferred();
    fetchMock.mockImplementation(async (url) => {
      await gate.promise;
      return responseFor(url);
    });
    const result = await loadCachedOrFetch(options);
    expect(result.snapshot).toEqual({ ...empty, labels: snapshot.labels });
    gate.resolve();
    await expect(result.updated).resolves.toEqual({ snapshot, failedKeys: [] });
  });
});

describe('bootstrap / retryBootstrap', () => {
  it('4 つの GET を応答を待たずに並列で開始する', async () => {
    const gate = deferred();
    fetchMock.mockImplementation(async (url) => {
      await gate.promise;
      return responseFor(url);
    });
    const pending = bootstrap(options);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    gate.resolve();
    await expect(pending).resolves.toEqual({ snapshot, failedKeys: [] });
  });

  it('resync はキャッシュを全件取り直し、since を付けない', async () => {
    await saveSnapshot(cached, options);
    await expect(bootstrap(options)).resolves.toEqual({ snapshot, failedKeys: [] });
    await expect(loadSnapshot(options)).resolves.toEqual(snapshot);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(cacheKeys.map((key) => `/api/${key}`));
  });

  it.each([
    ['9', '10', '9'], ['10', '9', '9'],
    ['9007199254740993', '9007199254740992', '9007199254740992'],
    [null, '10', null], ['10', null, null], [null, null, null],
    ['1.5', '10', null], ['10', 'invalid', null],
  ])('応答の cursor: places=%s, stamps=%s → %s', async (places, stamps, cursor) => {
    const source = { ...snapshot, cursors: { ...snapshot.cursors, places, stamps } };
    fetchMock.mockImplementation(async (url) => responseFor(url, source));
    const expected = {
      ...source, cursor,
      cursors: { ...source.cursors, places: pickCursor(places, places), stamps: pickCursor(stamps, stamps) },
    };
    await expect(bootstrap(options)).resolves.toEqual({ snapshot: expected, failedKeys: [] });
    await expect(loadSnapshot(options)).resolves.toEqual(expected);
  });

  it.each([null, 'invalid', '1.5'])('キャッシュの cursor=%s は null として読み、since 無しで取り直す', async (cursor) => {
    await saveSnapshot({ ...cached, cursors: { ...cached.cursors, places: cursor } }, options);
    expect((await loadSnapshot(options))!.cursor).toBeNull();
    const result = await loadCachedOrFetch(options);
    expect(result.snapshot.cursor).toBeNull();
    await expect(result.updated).resolves.toEqual({ snapshot, failedKeys: [] });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(cacheKeys.map((key) => `/api/${key}`));
  });

  it('4 キーそれぞれの cursor を保存し、Snapshot では places/stamps の小さい方を使う', async () => {
    const source = { ...snapshot, cursors: { places: '10', stamps: '9', landmarks: '12', labels: '13' } };
    fetchMock.mockImplementation(async (url) => responseFor(url, source));
    const set = vi.fn();
    setCacheStore({ async get() { return undefined; }, set });
    await expect(bootstrap(options)).resolves.toEqual({ snapshot: source, failedKeys: [] });
    for (const key of cacheKeys) {
      expect(set).toHaveBeenCalledWith(key, { value: source[key], cursor: source.cursors[key] });
    }
  });

  it.each(cacheKeys)('%s の取得だけ失敗しても、成功した一覧を使い、失敗分だけ再試行する', async (key) => {
    await saveSnapshot(cached, options);
    fetchMock.mockImplementation(async (url) => {
      if (url === `/api/${key}`) throw new TypeError('Failed to fetch');
      return responseFor(url);
    });
    const expected = structuredClone(snapshot);
    Object.assign(expected, { [key]: cached[key] });
    expected.cursors[key] = cached.cursors[key];
    expected.cursor = pickCursor(expected.cursors.places, expected.cursors.stamps);
    const first = await bootstrap(options);
    expect(first).toEqual({ snapshot: expected, failedKeys: [key] });
    await expect(loadSnapshot(options)).resolves.toEqual(expected);

    fetchMock.mockClear();
    fetchMock.mockImplementation(async (url) => responseFor(url));
    await expect(retryBootstrap(first.failedKeys, options)).resolves.toEqual({ snapshot, failedKeys: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/${key}`);
    await expect(loadSnapshot(options)).resolves.toEqual(snapshot);
  });

  it('キャッシュが無く一部取得が失敗した場合も、ほかの成功分を使う', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/stamps') throw new TypeError('offline');
      return responseFor(url);
    });
    const expected = { ...snapshot, stamps: [], cursor: null, cursors: { ...snapshot.cursors, stamps: null } };
    await expect(bootstrap(options)).resolves.toEqual({ snapshot: expected, failedKeys: ['stamps'] });
    await expect(loadSnapshot(options)).resolves.toEqual(expected);
  });

  it('1 件が失敗しても、残りの応答を待って保存する', async () => {
    const gate = deferred();
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/labels') throw new TypeError('offline');
      await gate.promise;
      return responseFor(url);
    });
    const settled = vi.fn();
    const pending = bootstrap(options);
    void pending.then(settled);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(settled).not.toHaveBeenCalled();
    gate.resolve();
    const result = await pending;
    expect(result.failedKeys).toEqual(['labels']);
    expect(result.snapshot.places).toEqual(snapshot.places);
    expect(result.snapshot.labels).toEqual([]);
    await expect(loadSnapshot(options)).resolves.toEqual(result.snapshot);
  });

  it('再試行にも失敗したら、そのキーを再び返してキャッシュを保つ', async () => {
    await saveSnapshot(cached, options);
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(retryBootstrap(['stamps'], options)).resolves.toEqual({ snapshot: cached, failedKeys: ['stamps'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadSnapshot(options)).resolves.toEqual(cached);
  });

  it('配列でない応答や壊れたスタンプもそのキーの失敗として扱う', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/labels') return Response.json({ items: null });
      if (url === '/api/stamps') return Response.json({ items: [null], cursor: '9' });
      return responseFor(url);
    });
    const result = await bootstrap(options);
    expect(result.failedKeys).toEqual(['stamps', 'labels']);
    expect(result.snapshot.places).toEqual(snapshot.places);
    expect(result.snapshot.landmarks).toEqual(snapshot.landmarks);
    expect(result.snapshot.cursor).toBeNull();
  });

  it('保存先が使えなくても取得したデータを返す', async () => {
    setCacheStore({ async get() { throw new Error('read failed'); }, async set() { throw new Error('write failed'); } });
    await expect(bootstrap(options)).resolves.toEqual({ snapshot, failedKeys: [] });
  });

  it('取得した期限切れスタンプを返却時と保存時の両方で除く', async () => {
    const expired = { ...snapshot.stamps[0], id: 'expired', expiresAt: '2026-11-28T01:00:00Z' };
    const boundary = { ...expired, id: 'boundary', expiresAt: '2026-11-28T02:00:00Z' };
    fetchMock.mockImplementation(async (url) => responseFor(url, { ...snapshot, stamps: [expired, boundary, ...snapshot.stamps] }));
    await expect(bootstrap(options)).resolves.toEqual({ snapshot, failedKeys: [] });
    await expect(loadSnapshot(options)).resolves.toEqual(snapshot);
  });
});

describe('並行 bootstrap の保存順', () => {
  const newer: Snapshot = {
    ...snapshot, places: [{ ...snapshot.places[0], name: '新しい場所' }],
    cursor: '20', cursors: { ...snapshot.cursors, places: '21', stamps: '20' },
  };

  it('古い取得が後から完了しても、新しい世代の保存を上書きしない', async () => {
    const gate = deferred();
    fetchMock.mockImplementation(async (url) => {
      await gate.promise;
      return responseFor(url);
    });
    const older = bootstrap(options);
    fetchMock.mockImplementation(async (url) => responseFor(url, newer));
    await expect(bootstrap(options)).resolves.toEqual({ snapshot: newer, failedKeys: [] });
    gate.resolve();
    await older;
    await expect(loadSnapshot(options)).resolves.toEqual(newer);
  });

  it('古い store.set が進行中でも、新しい保存をその後に直列化する', async () => {
    const entries: { [K in CacheKey]?: CacheEntry<K> } = {};
    const entered = deferred();
    const release = deferred();
    setCacheStore({
      async get(key) { return entries[key]; },
      async set(key, entry) {
        if (key === 'places' && entry.cursor === '10') {
          entered.resolve();
          await release.promise;
        }
        Object.assign(entries, { [key]: structuredClone(entry) });
      },
    });
    const older = bootstrap(options);
    await entered.promise;
    fetchMock.mockImplementation(async (url) => responseFor(url, newer));
    const latest = bootstrap(options);
    const settled = vi.fn();
    void latest.then(settled);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    // 新しい応答の解析も終えてから古い set を解放し、保存の逆転を再現する。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settled).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([older, latest]);
    await expect(loadSnapshot(options)).resolves.toEqual(newer);
  });
});
