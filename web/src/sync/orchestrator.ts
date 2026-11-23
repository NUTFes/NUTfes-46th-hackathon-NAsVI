import { readonly, shallowReactive, toRaw } from 'vue';
import type { Pinia } from 'pinia';
import { getStorage, type CacheEntry as StoredCacheEntry, type StorageRepositories } from '../storage';
import {
  useChangesStore, useLabelsStore, useLandmarksStore, usePlacesStore, useStampsStore,
} from '../stores';
import { bootstrap, loadCachedOrFetch } from './bootstrap';
import {
  createSnapshotWriter, pickCursor, setCacheStore,
  type CacheEntry, type CacheKey, type CacheStore, type Snapshot,
} from './cache';
import { connectChanges, type ChangeEvent, type ConnectChangesOptions } from './changes';

export type SyncStorage = Pick<StorageRepositories,
  'cache' | 'destination' | 'tagLinks' | 'proofs' | 'mode' | 'onModeChange' | 'onWriteNotPersisted'>;

export interface SyncStores {
  replace(snapshot: Snapshot): void;
  read(): Pick<Snapshot, 'places' | 'stamps'>;
  applyChange(event: ChangeEvent): void;
  resetAppliedChangeIds(): void;
}

export interface OrchestratorOptions {
  pinia?: Pinia;
  storage?: SyncStorage;
  stores?: SyncStores;
  now?: () => number;
  changes?: Pick<ConnectChangesOptions, 'document' | 'EventSource' | 'fetch' | 'random'>;
  dependencies?: {
    getStorage?: typeof getStorage;
    loadCachedOrFetch?: typeof loadCachedOrFetch;
    bootstrap?: typeof bootstrap;
    connectChanges?: typeof connectChanges;
  };
}

function piniaStores(pinia?: Pinia): SyncStores {
  const places = usePlacesStore(pinia);
  const stamps = useStampsStore(pinia);
  const landmarks = useLandmarksStore(pinia);
  const labels = useLabelsStore(pinia);
  const changes = useChangesStore(pinia);
  return {
    replace(snapshot) {
      places.setAll(snapshot.places);
      stamps.setAll(snapshot.stamps);
      landmarks.setAll(snapshot.landmarks);
      labels.setAll(snapshot.labels);
    },
    // remove の filter 結果には Proxy の要素が入るため、配列だけでなく各要素も戻す。
    read: () => ({
      places: places.items.map(place => toRaw(place)),
      stamps: stamps.items.map(stamp => toRaw(stamp)),
    }),
    applyChange: event => changes.applyChange(event),
    resetAppliedChangeIds: () => changes.resetAppliedChangeIds(),
  };
}

/** W-02 の items/任意 cursor と W-03 の value/null cursor の境界。 */
export function storageCacheStore(storage: Pick<SyncStorage, 'cache'>): CacheStore {
  return {
    async get(key) {
      const entry = await storage.cache.get(key);
      return entry && { value: entry.items, cursor: entry.cursor ?? null } as CacheEntry<typeof key>;
    },
    async set(key, entry) {
      await storage.cache.save(key, {
        items: entry.value,
        ...(entry.cursor === null ? {} : { cursor: entry.cursor }),
      } as StoredCacheEntry<typeof key>);
    },
  };
}

/** アプリにつき1つ作る。start は更新完了まで待ち、state はキャッシュ表示中も公開する。 */
export function createSyncOrchestrator(options: OrchestratorOptions = {}) {
  const deps = {
    getStorage, loadCachedOrFetch, bootstrap, connectChanges, ...options.dependencies,
  };
  const now = options.now ?? Date.now;
  const visibility = options.changes?.document ?? globalThis.document;
  const state = shallowReactive({
    mode: null as SyncStorage['mode'] | null,
    writeNotPersisted: false,
    syncing: false,
    failedKeys: [] as CacheKey[],
    error: null as unknown,
  });
  let storage: SyncStorage;
  let stores: SyncStores;
  let snapshot: Snapshot | undefined;
  let connection: ReturnType<typeof connectChanges> | undefined;
  let write: ReturnType<typeof createSnapshotWriter> | undefined;
  let stopped = false;
  let generation = 0;
  let refreshEpoch = 0;
  let startPromise: Promise<void> | undefined;
  let refreshPromise: Promise<void> | undefined;
  let pending = Promise.resolve();
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const subscriptions: Array<() => void> = [];

  function enqueue(action: () => Promise<void>): Promise<void> {
    const task = pending.then(action);
    pending = task.catch(error => { if (!stopped) state.error = error; });
    return pending;
  }

  function disconnect() {
    generation++;
    connection?.close();
    connection = undefined;
  }

  async function removeReferences(placeId: string) {
    if ((await storage.destination.get())?.placeId === placeId) await storage.destination.clear();
    for (const link of await storage.tagLinks.list(placeId)) {
      await storage.tagLinks.delete(link.placeId, link.tagId);
    }
  }

  async function reconcilePlaces(current: Snapshot) {
    const ids = new Set(current.places.map(place => place.id));
    const destination = await storage.destination.get();
    if (destination && !ids.has(destination.placeId)) await storage.destination.clear();
    for (const link of await storage.tagLinks.list()) {
      if (!ids.has(link.placeId)) await storage.tagLinks.delete(link.placeId, link.tagId);
    }
  }

  async function pruneProofs() {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (stopped) return;
    await storage.proofs.pruneExpired(now());
    const proofs = await storage.proofs.list();
    if (stopped || visibility?.visibilityState === 'hidden') return;
    const next = Math.min(...proofs.map(proof => Date.parse(proof.expiresAt)).filter(Number.isFinite));
    if (Number.isFinite(next)) {
      expiryTimer = setTimeout(() => {
        void enqueue(pruneProofs);
      }, Math.min(2_147_483_647, Math.max(0, next - now())));
    }
  }

  function onVisibilityChange() {
    if (visibility.visibilityState === 'hidden') {
      clearTimeout(expiryTimer);
      expiryTimer = undefined;
    } else {
      void enqueue(pruneProofs);
    }
    // SSE の中断・再接続と cursor の保持は W-04 が担当する。
  }

  function connect() {
    if (stopped || !snapshot || snapshot.cursor === null) return;
    const currentGeneration = ++generation;
    connection = deps.connectChanges({
      ...options.changes,
      since: snapshot.cursor,
      onEvent(event) {
        if (stopped || currentGeneration !== generation || !snapshot) return;
        // 一覧ごとに取得時点が違うため、既にその一覧に含まれる古い出来事は適用しない。
        const key = event.type.startsWith('place') ? 'places'
          : event.type.startsWith('stamp') ? 'stamps' : undefined;
        const baseline = key ? snapshot.cursors[key] : snapshot.cursor;
        if (baseline !== null && BigInt(event.id) <= BigInt(baseline)) return;
        stores.applyChange(event);
        snapshot = capture(snapshot, event);
        const current = structuredClone(snapshot);
        const persist = write;
        void enqueue(async () => {
          if (event.type === 'placeRemoved' && typeof event.payload === 'object'
            && event.payload !== null && 'id' in event.payload && typeof event.payload.id === 'string') {
            await removeReferences(event.payload.id);
          }
          if (persist) await persist(current);
          await pruneProofs();
        });
      },
      onResync() {
        if (stopped || currentGeneration !== generation) return;
        void resync();
      },
    });
  }

  // 出来事の適用は W-05 のみに任せる。既定ではその Pinia の結果を保存する。
  function capture(previous: Snapshot, event: ChangeEvent): Snapshot {
    const cursors = { ...previous.cursors };
    for (const key of ['places', 'stamps'] as const) {
      const cursor = cursors[key];
      if (cursor === null || BigInt(cursor) < BigInt(event.id)) cursors[key] = String(event.id);
    }
    return {
      ...previous,
      ...stores.read(),
      cursors,
      cursor: pickCursor(cursors.places, cursors.stamps),
    };
  }

  async function replace(current: Snapshot, failedKeys: CacheKey[], epoch: number, reconnect = true) {
    disconnect();
    // 旧一覧の保存・参照整理を終えてから新しい一覧を公開する。
    await pending;
    if (stopped || epoch !== refreshEpoch) return;
    stores.resetAppliedChangeIds();
    snapshot = structuredClone(current);
    stores.replace(current);
    state.failedKeys = [...failedKeys];
    write = createSnapshotWriter({ now });
    if (reconnect) connect();
    if (!failedKeys.includes('places')) await enqueue(() => reconcilePlaces(current));
    await enqueue(pruneProofs);
  }

  async function initialize() {
    const epoch = ++refreshEpoch;
    state.syncing = true;
    try {
      storage = options.storage ?? await deps.getStorage();
      if (stopped) return;
      stores = options.stores ?? piniaStores(options.pinia);
      state.mode = storage.mode;
      subscriptions.push(storage.onModeChange(mode => {
        state.mode = mode;
        if (mode === 'indexeddb') state.writeNotPersisted = false;
      }), storage.onWriteNotPersisted(() => { state.writeNotPersisted = true; }));
      visibility?.addEventListener('visibilitychange', onVisibilityChange);
      setCacheStore(storageCacheStore(storage));
      void enqueue(pruneProofs);
      const cached = await deps.loadCachedOrFetch({ now });
      // close/resync 中でも updated の失敗を未処理の Promise にしない。
      void cached.updated.catch(() => {});
      if (stopped || epoch !== refreshEpoch) return;
      snapshot = structuredClone(cached.snapshot);
      stores.replace(cached.snapshot);
      // refresh が保存中なので、キャッシュ由来の出来事はまだ保存しない。
      connect();
      const updated = await cached.updated;
      if (!stopped && epoch === refreshEpoch) await replace(updated.snapshot, updated.failedKeys, epoch);
    } catch (error) {
      if (!stopped && epoch === refreshEpoch) state.error = error;
    } finally {
      if (!stopped && epoch === refreshEpoch) state.syncing = false;
    }
  }

  function start(): Promise<void> {
    if (stopped) return Promise.resolve();
    return startPromise ??= initialize();
  }

  function resync(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (!snapshot) return start();
    if (refreshPromise) return refreshPromise;
    const epoch = ++refreshEpoch;
    disconnect();
    write = undefined;
    state.syncing = true;
    state.error = null;
    refreshPromise = (async () => {
      try {
        await pending;
        const updated = await deps.bootstrap({ now });
        if (!stopped) await replace(updated.snapshot, updated.failedKeys, epoch,
          !updated.failedKeys.some(key => key === 'places' || key === 'stamps'));
      } catch (error) {
        if (!stopped) state.error = error;
      } finally {
        refreshPromise = undefined;
        if (!stopped) state.syncing = false;
      }
    })();
    return refreshPromise;
  }

  function close() {
    if (stopped) return;
    stopped = true;
    disconnect();
    clearTimeout(expiryTimer);
    visibility?.removeEventListener('visibilitychange', onVisibilityChange);
    subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
    state.syncing = false;
    // 保存先はアプリ共有なので close しない。
  }

  return { state: readonly(state), start, resync, close, flush: () => pending };
}
