// @vitest-environment node
import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, DB_NAME, type StorageRepositories } from '../storage';
import {
  useChangesStore, useLabelsStore, useLandmarksStore, usePlacesStore, useStampsStore,
} from '../stores';
import { cacheKeys, loadSnapshot, saveSnapshot, setCacheStore, type CacheEntry, type Snapshot } from './cache';
import type { BootstrapResult, CachedBootstrap } from './bootstrap';
import { connectChanges, type ConnectChangesOptions } from './changes';
import { createSyncOrchestrator, storageCacheStore, type OrchestratorOptions } from './orchestrator';

const NOW = Date.parse('2026-11-28T02:00:00Z');
const fresh: Snapshot = {
  places: [{
    id: 'place', name: '企画', kind: 'event', location: { lat: 37.4252, lng: 138.7788 },
    description: '', landmarkId: null, floor: null, hours: [], labelIds: ['label'],
  }],
  stamps: [{
    id: 'stamp', kind: 'fun', at: { lat: 37.4252, lng: 138.7788 },
    pressedAt: '2026-11-28T01:00:00Z', expiresAt: '2026-11-28T07:00:00Z',
  }],
  landmarks: [{
    id: 'building', name: '講義棟', location: { lat: 37.4252, lng: 138.7788 },
    footprint: null, floors: [],
  }],
  labels: [{ id: 'label', title: '展示' }],
  cursor: '9', cursors: { places: '10', stamps: '9', landmarks: null, labels: null },
};
const cached: Snapshot = {
  ...fresh,
  places: [{ ...fresh.places[0], name: '以前の企画' }],
  cursor: '2', cursors: { places: '3', stamps: '2', landmarks: null, labels: null },
};

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  emit(type: string, payload: unknown = {}, id = '') {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(payload), lastEventId: id }));
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database is still open'));
  });
}

function responseFor(url: RequestInfo | URL, snapshot = fresh) {
  if (String(url).startsWith('/api/changes?')) return new Response(null, { status: 200 });
  const key = cacheKeys.find(key => String(url) === `/api/${key}`);
  if (!key) throw new Error(`Unexpected request: ${url}`);
  return Response.json({ items: snapshot[key], cursor: snapshot.cursors[key] ?? undefined });
}

const fetchMock = vi.fn<typeof fetch>();
let storage: StorageRepositories;
let visibility: FakeDocument;
let apps: ReturnType<typeof createSyncOrchestrator>[];

function app(options: OrchestratorOptions = {}) {
  const instance = createSyncOrchestrator({
    storage, now: () => NOW,
    changes: { document: visibility, EventSource: FakeEventSource, fetch: fetchMock, random: () => 0 },
    ...options,
  });
  apps.push(instance);
  return instance;
}

function latest() {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1];
}

async function seed(snapshot = cached) {
  setCacheStore(storageCacheStore(storage));
  await saveSnapshot(snapshot, { now: () => NOW });
}

beforeEach(async () => {
  await deleteDatabase();
  storage = await createStorage();
  setActivePinia(createPinia());
  setCacheStore();
  apps = [];
  visibility = new FakeDocument();
  FakeEventSource.instances = [];
  fetchMock.mockReset().mockImplementation(async url => responseFor(url));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('document', visibility);
  vi.stubEnv('VITE_API_BASE', '');
});

afterEach(async () => {
  for (const instance of apps) instance.close();
  vi.useRealTimers();
  await Promise.all(apps.map(instance => instance.flush()));
  await storage.close();
  setCacheStore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await deleteDatabase();
});

describe('保存層・初回取得・ストアの結線', () => {
  it('(1) 全4キーで items/value と任意/null cursor を変換し、IndexedDB に往復する', async () => {
    expect(storage.mode).toBe('indexeddb');
    const adapter = storageCacheStore(storage);
    for (const key of cacheKeys) {
      expect(await adapter.get(key)).toBeUndefined();
      await adapter.set(key, { value: fresh[key], cursor: fresh.cursors[key] } as CacheEntry<typeof key>);
      expect(await storage.cache.get(key)).toEqual({
        items: fresh[key], ...(fresh.cursors[key] === null ? {} : { cursor: fresh.cursors[key] }),
      });
      expect(await adapter.get(key)).toEqual({ value: fresh[key], cursor: fresh.cursors[key] });
    }
    setCacheStore(adapter);
    expect(await loadSnapshot({ now: () => NOW })).toEqual(fresh);
  });

  it('(2) キャッシュ無しでは全一覧を待ち、W-05 の4ストアと永続キャッシュへ反映する', async () => {
    const gate = deferred<void>();
    fetchMock.mockImplementation(async url => { await gate.promise; return responseFor(url); });
    const instance = app();
    const starting = instance.start();
    expect(instance.start()).toBe(starting);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(usePlacesStore().items).toEqual([]);
    expect(FakeEventSource.instances).toHaveLength(0);
    gate.resolve();
    await starting;
    expect(usePlacesStore().items).toEqual(fresh.places);
    expect(useStampsStore().items).toEqual(fresh.stamps);
    expect(useLandmarksStore().items).toEqual(fresh.landmarks);
    expect(useLabelsStore().items).toEqual(fresh.labels);
    expect(latest().url).toBe('/api/changes?since=9');
    expect(await loadSnapshot({ now: () => NOW })).toEqual(fresh);
    expect(instance.state.failedKeys).toEqual([]);
    expect(instance.state.error).toBeNull();
    expect(instance.state.syncing).toBe(false);
  });

  it('(2) キャッシュを先に表示して cursor から接続し、取得後は全ストアを差し替える', async () => {
    await seed();
    const gate = deferred<void>();
    fetchMock.mockImplementation(async url => { await gate.promise; return responseFor(url); });
    const instance = app();
    const starting = instance.start();
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(usePlacesStore().items).toEqual(cached.places);
    expect(latest().url).toBe('/api/changes?since=2');
    expect(instance.state.syncing).toBe(true);
    const old = latest();
    gate.resolve();
    await starting;
    expect(old.close).toHaveBeenCalledOnce();
    expect(usePlacesStore().items).toEqual(fresh.places);
    expect(latest().url).toBe('/api/changes?since=9');
  });

  it('取得中に適用した出来事は、新 cursor からの再配信で失わず、古い接続は無視する', async () => {
    await seed();
    const gate = deferred<void>();
    fetchMock.mockImplementation(async url => { await gate.promise; return responseFor(url); });
    const instance = app();
    const starting = instance.start();
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const old = latest();
    const updatedPlace = { ...fresh.places[0], name: '取得開始後の更新' };
    old.emit('placeUpdated', updatedPlace, '11');
    expect(usePlacesStore().items).toEqual([updatedPlace]);
    gate.resolve();
    await starting;
    old.emit('placeRemoved', { id: 'place' }, '99');
    latest().emit('placeUpdated', updatedPlace, '11');
    await instance.flush();
    expect(usePlacesStore().items).toEqual([updatedPlace]);
    expect((await storage.cache.get('places'))?.items).toEqual([updatedPlace]);
    expect((await storage.cache.get('places'))?.cursor).toBe('11');
  });

  it('一覧ごとの cursor 以前の出来事を再適用せず、新しい出来事は W-05 で冪等に適用する', async () => {
    const instance = app();
    await instance.start();
    const source = latest();
    source.emit('placeUpdated', { ...fresh.places[0], name: '古い名前' }, '10');
    expect(usePlacesStore().items).toEqual(fresh.places);
    const stamp = { ...fresh.stamps[0], id: 'new-stamp' };
    source.emit('stampPressed', stamp, '11');
    source.emit('stampPressed', stamp, '11');
    source.emit('stampRetracted', { id: 'stamp' }, '12');
    source.emit('appVersionChanged', { version: 'v2' }, '13');
    await instance.flush();
    expect(useStampsStore().items).toEqual([stamp]);
    expect(useChangesStore().versionChanged).toBe(true);
    expect((await storage.cache.get('stamps'))?.items).toEqual([stamp]);
    expect((await storage.cache.get('stamps'))?.cursor).toBe('13');
    expect(instance.state.error).toBeNull();
  });

  it('全件取得が失敗してもキャッシュ表示と接続を保ち、失敗キーを公開する', async () => {
    await seed();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const instance = app();
    await instance.start();
    expect(usePlacesStore().items).toEqual(cached.places);
    expect(instance.state.failedKeys).toEqual(cacheKeys);
    expect(latest().url).toBe('/api/changes?since=2');
  });

  it('キャッシュ無しの全件失敗・cursor 不明では、推測した cursor で接続しない', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const instance = app();
    await instance.start();
    expect(instance.state.failedKeys).toEqual(cacheKeys);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('注入した Pinia を使い、別のアプリのストアへ適用しない', async () => {
    const target = createPinia();
    const instance = app({ pinia: target });
    await instance.start();
    const other = createPinia();
    setActivePinia(other);
    // Pinia の action は activePinia を自身のインスタンスへ切り替える。
    // 更新後も比較対象を明示し、別アプリへの漏れを検査する。
    const otherPlaces = usePlacesStore(other);
    const otherStamps = useStampsStore(other);
    latest().emit('placeRemoved', { id: 'place' }, '11');
    await instance.flush();
    expect(usePlacesStore(target).items).toEqual([]);
    expect(useStampsStore(target).items).toEqual(fresh.stamps);
    expect(otherPlaces.items).toEqual([]);
    expect(otherStamps.items).toEqual([]);
  });
});

describe('resync と再接続', () => {
  it('(3) onResync で全件を取り直し、適用済みIDをリセットして新 cursor で接続する', async () => {
    const instance = app();
    await instance.start();
    latest().emit('placeUpdated', { ...fresh.places[0], name: '以前の更新' }, '11');
    await instance.flush();
    expect(useChangesStore().appliedChangeIds.has(11)).toBe(true);
    const reset = vi.spyOn(useChangesStore(), 'resetAppliedChangeIds');
    const next: Snapshot = { ...fresh, cursor: '1', cursors: { ...fresh.cursors, places: '1', stamps: '1' } };
    fetchMock.mockClear().mockImplementation(async url => responseFor(url, next));
    const old = latest();
    old.emit('resync');
    const refreshing = instance.resync();
    expect(instance.resync()).toBe(refreshing);
    await refreshing;
    expect(old.close).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(cacheKeys.map(key => `/api/${key}`));
    expect(reset).toHaveBeenCalledOnce();
    expect(useChangesStore().appliedChangeIds.size).toBe(0);
    expect(latest().url).toBe('/api/changes?since=1');
    latest().emit('placeUpdated', { ...fresh.places[0], name: '巻き戻ったIDでの更新' }, '11');
    await instance.flush();
    expect(usePlacesStore().items[0].name).toBe('巻き戻ったIDでの更新');
  });

  it('resync 中は旧接続からの出来事を無視し、古い起動時取得で結果を上書きしない', async () => {
    await seed();
    const initial = deferred<BootstrapResult>();
    const resynced: Snapshot = { ...fresh, places: [{ ...fresh.places[0], name: 'resync 結果' }] };
    const instance = app({ dependencies: {
      loadCachedOrFetch: async () => ({ snapshot: cached, updated: initial.promise }),
      bootstrap: async () => ({ snapshot: resynced, failedKeys: [] }),
    } });
    const starting = instance.start();
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const old = latest();
    old.emit('resync');
    await instance.resync();
    initial.resolve({ snapshot: cached, failedKeys: [] });
    await starting;
    old.emit('placeRemoved', { id: 'place' }, '99');
    expect(usePlacesStore().items).toEqual(resynced.places);
    expect(latest().url).toBe('/api/changes?since=9');
    expect(instance.state.syncing).toBe(false);
  });

  it('resync の主要一覧が失敗したら旧 cursor で繰り返し接続せず、明示的に再試行できる', async () => {
    const instance = app();
    await instance.start();
    const count = FakeEventSource.instances.length;
    fetchMock.mockRejectedValue(new TypeError('offline'));
    latest().emit('resync');
    await instance.resync();
    expect(FakeEventSource.instances).toHaveLength(count);
    expect(instance.state.failedKeys).toEqual(cacheKeys);
    fetchMock.mockImplementation(async url => responseFor(url));
    await instance.resync();
    expect(FakeEventSource.instances).toHaveLength(count + 1);
    expect(instance.state.failedKeys).toEqual([]);
  });

  it('切断後は W-04 の待ち時間で最後の出来事から復帰し、全件取得は増やさない', async () => {
    const instance = app();
    await instance.start();
    // fake-indexeddb のトランザクションを進める setImmediate は実時間のままにする。
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    latest().emit('placeUpdated', { ...fresh.places[0], name: '更新' }, '11');
    await instance.flush();
    fetchMock.mockClear();
    const source = latest();
    const count = FakeEventSource.instances.length;
    source.emit('error');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(source.close).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances).toHaveLength(count + 1);
    expect(latest().url).toBe('/api/changes?since=11');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/changes?since=11']);
  });

  it('(6) hidden で閉じて visible で最後の cursor から再接続する', async () => {
    const instance = app();
    await instance.start();
    latest().emit('placeUpdated', { ...fresh.places[0], name: '更新' }, '11');
    await instance.flush();
    const old = latest();
    const count = FakeEventSource.instances.length;
    fetchMock.mockClear();
    visibility.setVisibility('hidden');
    expect(old.close).toHaveBeenCalledOnce();
    old.emit('placeRemoved', { id: 'place' }, '99');
    visibility.setVisibility('visible');
    visibility.setVisibility('visible');
    await instance.flush();
    expect(FakeEventSource.instances).toHaveLength(count + 1);
    expect(latest().url).toBe('/api/changes?since=11');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePlacesStore().items).toHaveLength(1);
  });

  it('(6) 非表示中に resync の取得が終わっても、表示するまでは接続しない', async () => {
    const instance = app();
    await instance.start();
    const gate = deferred<void>();
    fetchMock.mockImplementation(async url => { await gate.promise; return responseFor(url); });
    const count = FakeEventSource.instances.length;
    latest().emit('resync');
    visibility.setVisibility('hidden');
    gate.resolve();
    await instance.resync();
    expect(FakeEventSource.instances).toHaveLength(count);
    visibility.setVisibility('visible');
    expect(FakeEventSource.instances).toHaveLength(count + 1);
  });

  it('close 後に resync の取得が完了しても、一覧の置換と再接続をしない', async () => {
    const result = deferred<BootstrapResult>();
    const instance = app({ dependencies: { bootstrap: () => result.promise } });
    await instance.start();
    const count = FakeEventSource.instances.length;
    const refreshing = instance.resync();
    instance.close();
    result.resolve({ snapshot: { ...fresh, places: [] }, failedKeys: [] });
    await refreshing;
    expect(usePlacesStore().items).toEqual(fresh.places);
    expect(FakeEventSource.instances).toHaveLength(count);
    expect(instance.state.syncing).toBe(false);
  });
});

describe('端末内の参照と期限', () => {
  it('(4) placeRemoved で対象の行き先と全 tagLinks を削除し、タグ本体・他の場所・スタンプを保つ', async () => {
    await seed();
    await storage.destination.save({ placeId: 'place' });
    await storage.tagLinks.save({ placeId: 'place', tagId: 'favorite' });
    await storage.tagLinks.save({ placeId: 'place', tagId: 'want-to-go' });
    const other = { ...fresh.places[0], id: 'other' };
    const withOther: Snapshot = { ...fresh, places: [...fresh.places, other] };
    await storage.tagLinks.save({ placeId: 'other', tagId: 'favorite' });
    fetchMock.mockImplementation(async url => responseFor(url, withOther));
    const instance = app();
    await instance.start();
    latest().emit('placeRemoved', { id: 'place' }, '11');
    latest().emit('placeRemoved', { id: 'place' }, '11');
    await instance.flush();
    expect(await storage.destination.get()).toBeNull();
    expect(await storage.tagLinks.list()).toEqual([{ placeId: 'other', tagId: 'favorite' }]);
    expect(await storage.tags.list()).toHaveLength(2);
    expect(usePlacesStore().items).toEqual([other]);
    expect(useStampsStore().items).toEqual(fresh.stamps);
    expect((await storage.cache.get('places'))?.items).toEqual([other]);
  });

  it('(4) 他の場所の削除や不正 payload で、現在の行き先を解除しない', async () => {
    await seed();
    await storage.destination.save({ placeId: 'place' });
    const instance = app();
    await instance.start();
    latest().emit('placeRemoved', { id: 'other' }, '11');
    latest().emit('placeRemoved', { id: 123 }, '12');
    await instance.flush();
    expect(await storage.destination.get()).toEqual({ placeId: 'place' });
    expect(usePlacesStore().items).toEqual(fresh.places);
  });

  it('取得に成功した場所一覧にない参照は整理し、取得失敗時には消さない', async () => {
    await seed();
    await storage.destination.save({ placeId: 'place' });
    await storage.tagLinks.save({ placeId: 'place', tagId: 'favorite' });
    fetchMock.mockImplementation(async url => {
      if (url === '/api/places') throw new TypeError('offline');
      return responseFor(url);
    });
    const instance = app();
    await instance.start();
    expect(await storage.destination.get()).toEqual({ placeId: 'place' });
    expect(await storage.tagLinks.list('place')).toHaveLength(1);
    fetchMock.mockImplementation(async url => responseFor(url, { ...fresh, places: [] }));
    await instance.resync();
    expect(await storage.destination.get()).toBeNull();
    expect(await storage.tagLinks.list()).toEqual([]);
  });

  it('(5) IndexedDB の期限切れ・同時刻・不正な期限の proof を削除し、有効な proof は保つ', async () => {
    for (const [stampId, expiresAt] of [
      ['expired', new Date(NOW - 1).toISOString()], ['boundary', new Date(NOW).toISOString()],
      ['invalid', 'invalid'], ['active', new Date(NOW + 1_000).toISOString()],
    ]) await storage.proofs.save({ stampId, expiresAt, proof: 'local-only' });
    const prune = vi.spyOn(storage.proofs, 'pruneExpired');
    const instance = app();
    await instance.start();
    expect(prune).toHaveBeenCalledWith(NOW);
    expect((await storage.proofs.list()).map(proof => proof.stampId)).toEqual(['active']);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.body)).toBe(true);
  });

  it('(5) 起動後も proof の期限で削除し、hidden 中の経過は visible 時に整理する', async () => {
    // タイマーはメモリ保存先で独立に検査。上のテストは実際の IndexedDB を検査する。
    const memory = await createStorage({ memory: true });
    try {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(NOW);
      await memory.proofs.save({ stampId: 'first', proof: 'local', expiresAt: new Date(NOW + 1_000).toISOString() });
      await memory.proofs.save({ stampId: 'second', proof: 'local', expiresAt: new Date(NOW + 2_000).toISOString() });
      const instance = app({ storage: memory, now: Date.now });
      await instance.start();
      await vi.advanceTimersByTimeAsync(1_000);
      await instance.flush();
      expect(await memory.proofs.get('first')).toBeUndefined();
      expect(await memory.proofs.get('second')).toBeDefined();
      visibility.setVisibility('hidden');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await memory.proofs.get('second')).toBeDefined();
      visibility.setVisibility('visible');
      await instance.flush();
      expect(await memory.proofs.get('second')).toBeUndefined();
      instance.close();
    } finally {
      await memory.close();
    }
  });
});

describe('状態の公開と終了処理・依存注入', () => {
  it('(7) 保存モードと未永続化通知をアプリのリアクティブな状態として公開する', async () => {
    let modeChanged!: (mode: 'indexeddb' | 'memory') => void;
    let writeLost!: () => void;
    const unsubscribeMode = vi.fn();
    const unsubscribeWrite = vi.fn();
    const instance = app({ storage: {
      ...storage,
      onModeChange: cb => { modeChanged = cb; return unsubscribeMode; },
      onWriteNotPersisted: cb => { writeLost = cb; return unsubscribeWrite; },
    } });
    await instance.start();
    expect(instance.state.mode).toBe('indexeddb');
    expect(instance.state.writeNotPersisted).toBe(false);
    modeChanged('memory');
    expect(instance.state.mode).toBe('memory');
    expect(instance.state.writeNotPersisted).toBe(false);
    writeLost();
    expect(instance.state.writeNotPersisted).toBe(true);
    modeChanged('indexeddb');
    expect(instance.state.mode).toBe('indexeddb');
    expect(instance.state.writeNotPersisted).toBe(false);
    instance.close();
    expect(unsubscribeMode).toHaveBeenCalledOnce();
    expect(unsubscribeWrite).toHaveBeenCalledOnce();
  });

  it('(7) 実際のメモリフォールバックの書き込みでも未永続化状態になる', async () => {
    const memory = await createStorage({ memory: true });
    const instance = app({ storage: memory });
    try {
      await instance.start();
      expect(instance.state.mode).toBe('memory');
      expect(instance.state.writeNotPersisted).toBe(true);
      instance.close();
    } finally {
      await instance.flush();
      await memory.close();
    }
  });

  it('保存層・ストア・bootstrap・接続を注入でき、遅れて届く旧コールバックを無視する', async () => {
    const realPlaces = usePlacesStore();
    const realStamps = useStampsStore();
    const apply = vi.fn((event: Parameters<ConnectChangesOptions['onEvent']>[0]) => useChangesStore().applyChange(event));
    const reset = vi.fn(() => useChangesStore().resetAppliedChangeIds());
    const replace = vi.fn((snapshot: Snapshot) => {
      realPlaces.setAll(snapshot.places);
      realStamps.setAll(snapshot.stamps);
    });
    const connection = vi.fn<typeof connectChanges>(() => ({ close: vi.fn() }));
    const get = vi.fn(async () => storage);
    const refresh = vi.fn(async () => ({ snapshot: fresh, failedKeys: [] }));
    const instance = app({ storage: undefined, stores: {
      replace, applyChange: apply, resetAppliedChangeIds: reset,
      read: () => ({ places: structuredClone(fresh.places), stamps: structuredClone(fresh.stamps) }),
    }, dependencies: { getStorage: get, bootstrap: refresh, connectChanges: connection } });
    await instance.start();
    expect(get).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalled();
    const previous = connection.mock.calls[connection.mock.calls.length - 1][0];
    previous.onResync();
    await instance.resync();
    expect(refresh).toHaveBeenCalledOnce();
    apply.mockClear();
    previous.onEvent({ id: 99, type: 'placeRemoved', payload: { id: 'place' } });
    previous.onResync();
    expect(apply).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('close で接続・リスナー・タイマーを解除し、共有保存先は閉じない', async () => {
    const remove = vi.spyOn(visibility, 'removeEventListener');
    const closeStorage = vi.spyOn(storage, 'close');
    const instance = app();
    await instance.start();
    const old = latest();
    const count = FakeEventSource.instances.length;
    instance.close();
    instance.close();
    old.emit('placeRemoved', { id: 'place' }, '11');
    visibility.setVisibility('hidden');
    visibility.setVisibility('visible');
    await instance.start();
    await instance.resync();
    expect(old.close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(FakeEventSource.instances).toHaveLength(count);
    expect(usePlacesStore().items).toEqual(fresh.places);
    expect(closeStorage).not.toHaveBeenCalled();
  });

  it('close 後に初回取得が完了してもストア更新・接続を始めない', async () => {
    const gate = deferred<CachedBootstrap>();
    const load = vi.fn(() => gate.promise);
    const instance = app({ dependencies: { loadCachedOrFetch: load } });
    const starting = instance.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    instance.close();
    gate.resolve({ snapshot: fresh, updated: Promise.resolve({ snapshot: fresh, failedKeys: [] }) });
    await starting;
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(usePlacesStore().items).toEqual([]);
    expect(instance.state.syncing).toBe(false);
  });

  it('背景の保存失敗を未処理の Promise にせず、状態に公開する', async () => {
    const instance = app();
    await instance.start();
    const error = new Error('cleanup failed');
    vi.spyOn(storage.tagLinks, 'list').mockRejectedValue(error);
    latest().emit('placeRemoved', { id: 'place' }, '11');
    await instance.flush();
    expect(instance.state.error).toBe(error);
  });
});
