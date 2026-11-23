import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { createStorage, type StorageRepositories } from '../storage';
import { usePlacesStore } from '../stores';
import { cacheKeys, setCacheStore } from '../sync/cache';
import { createAppSync } from './sync';
import { event } from './testing';

let storage: StorageRepositories;
let sync: ReturnType<typeof createAppSync> | undefined;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let failPlaces: boolean;
beforeEach(async () => {
  failPlaces = true;
  storage = await createStorage({ memory: true });
  fetchMock = vi.fn<typeof fetch>(async input => {
    const key = cacheKeys.find(key => String(input) === `/api/${key}`);
    if (!key) throw new Error(`S-08: 未定義の通信 ${String(input)}`);
    if (key === 'places' && failPlaces) throw new Error('offline');
    return Response.json({ items: key === 'places' ? [event] : [], cursor: '1' });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', vi.fn(() => { throw new Error('S-08: 実接続は禁止'); }));
});
afterEach(async () => {
  sync?.close();
  await sync?.flush();
  sync = undefined;
  await storage.close();
  setCacheStore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('S-08 W-09 アダプター（実 orchestrator + モック fetch）', () => {
  it('refresh(failedKeys) は失敗した一覧だけを取得し W-09 でストアへ差し替える', async () => {
    const pinia = createPinia();
    const connect = vi.fn(() => ({ close: vi.fn() }));
    sync = createAppSync({ pinia, storage, dependencies: { connectChanges: connect } });
    await sync.start();
    expect(sync.hasSnapshot.value).toBe(true);
    expect(sync.state.failedKeys).toEqual(['places']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    failPlaces = false;
    fetchMock.mockClear();
    await sync.refresh(sync.state.failedKeys);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/places']);
    expect(sync.state.failedKeys).toEqual([]);
    expect(sync.state.error).toBeNull();
    expect(usePlacesStore(pinia).items).toEqual([event]);
    expect(connect).toHaveBeenCalled();
  });

  it('snapshot 後の throw から resync() で全一覧を再取得する', async () => {
    const pinia = createPinia();
    const connect = vi.fn(() => ({ close: vi.fn() }));
    sync = createAppSync({ pinia, storage, dependencies: {
      connectChanges: connect,
      async loadCachedOrFetch() {
        return {
          snapshot: { places: [], stamps: [], labels: [], landmarks: [], cursor: null,
            cursors: { places: null, stamps: null, labels: null, landmarks: null } },
          updated: Promise.reject(new Error('updated threw')),
        };
      },
    } });
    await sync.start();
    expect(sync.hasSnapshot.value).toBe(true);
    expect(sync.state.failedKeys).toEqual([]);
    expect(sync.state.error).toBeInstanceOf(Error);
    failPlaces = false;
    await sync.resync();
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(cacheKeys.map(key => `/api/${key}`));
    expect(sync.state.error).toBeNull();
    expect(usePlacesStore(pinia).items).toEqual([event]);
  });

  it('loadCachedOrFetch 自体の throw を snapshot 無しとして区別する', async () => {
    const load = vi.fn(async () => { throw new Error('load failed'); });
    sync = createAppSync({ pinia: createPinia(), storage, dependencies: { loadCachedOrFetch: load } });
    await sync.start();
    expect(sync.hasSnapshot.value).toBe(false);
    expect(sync.state.failedKeys).toEqual([]);
    expect(sync.state.error).toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
