// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState, Label, Landmark, MyTag, Place, Stamp } from '../types';
import {
  BUILTIN_TAGS, createStorage, getStorage, DB_NAME, DB_VERSION, STORE_NAMES,
  type CacheItems, type StampProof, type StorageRepositories,
} from './index';

const custom: MyTag = { id: 'my-tag', title: '昼に行く', builtin: false };
const proof: StampProof = { stampId: 'stamp-1', proof: 'secret', expiresAt: '2026-11-24T07:00:00Z' };
const place: Place = {
  id: 'place-1', name: '企画', kind: 'event', location: { lat: 37.4252, lng: 138.7788 },
  description: '', landmarkId: null, floor: null, hours: [], labelIds: ['label-1'],
};
const stamp: Stamp = {
  id: 'stamp-1', kind: 'fun', at: place.location,
  pressedAt: '2026-11-24T01:00:00Z', expiresAt: proof.expiresAt,
};
const landmark: Landmark = {
  id: 'building-1', name: '講義棟', location: place.location,
  footprint: [{ lat: 37.425, lng: 138.778 }, { lat: 37.426, lng: 138.778 }, { lat: 37.425, lng: 138.779 }],
  floors: [{ floor: 1, plan: { viewBox: '0 0 100 100', d: 'M0 0H100V100Z' }, bounds: { north: 37.426, south: 37.425, east: 138.779, west: 138.778 } }],
};
const label: Label = { id: 'label-1', title: '飲食' };
const lists: CacheItems = { places: [place], stamps: [stamp], landmarks: [landmark], labels: [label] };

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Test leaked a database connection'));
  });
}

function inspectDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let instances: StorageRepositories[] = [];
async function open(memory = false) {
  const storage = await createStorage({ memory });
  instances.push(storage);
  return storage;
}

beforeEach(deleteDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(instances.map(storage => storage.close()));
  instances = [];
  await deleteDatabase();
});

describe.each([false, true])('repositories (memory=%s)', memory => {
  let storage: StorageRepositories;
  beforeEach(async () => { storage = await open(memory); });

  it('seeds exactly two builtin tags and returns detached values', async () => {
    expect(storage.mode).toBe(memory ? 'memory' : 'indexeddb');
    expect(await storage.tags.list()).toEqual(expect.arrayContaining([...BUILTIN_TAGS]));
    const tags = await storage.tags.list();
    expect(tags).toHaveLength(2);
    tags[0].title = 'changed outside storage';
    expect(await storage.tags.get(tags[0].id)).not.toEqual(tags[0]);
  });

  it('saves, reads, updates and deletes custom tags', async () => {
    expect(await storage.tags.get(custom.id)).toBeUndefined();
    await storage.tags.save(custom);
    expect(await storage.tags.get(custom.id)).toEqual(custom);
    await storage.tags.save({ ...custom, title: '夜に行く' });
    expect((await storage.tags.get(custom.id))?.title).toBe('夜に行く');
    await storage.tags.delete(custom.id);
    expect(await storage.tags.get(custom.id)).toBeUndefined();
    await storage.tags.delete(custom.id);
  });

  it('protects builtin tags and continues after a rejected operation', async () => {
    for (const builtin of BUILTIN_TAGS) {
      await expect(storage.tags.delete(builtin.id)).rejects.toThrow('Builtin');
      await expect(storage.tags.save({ ...builtin, title: 'renamed', builtin: false })).rejects.toThrow('Builtin');
    }
    await expect(storage.tags.save({ ...custom, builtin: true })).rejects.toThrow('Builtin');
    await storage.tags.save(custom);
    expect(await storage.tags.get(custom.id)).toEqual(custom);
  });

  it('assigns multiple tags/places with collision-free, idempotent compound keys', async () => {
    const other: MyTag = { id: 'a:b', title: 'other', builtin: false };
    await storage.tags.save({ ...custom, id: 'b' });
    await storage.tags.save(other);
    await storage.tagLinks.save({ placeId: 'p:a', tagId: 'b' });
    await storage.tagLinks.save({ placeId: 'p', tagId: 'a:b' });
    await storage.tagLinks.save({ placeId: 'p:a', tagId: 'b' });
    expect(await storage.tagLinks.list()).toHaveLength(2);
    expect(await storage.tagLinks.list('p')).toEqual([{ placeId: 'p', tagId: 'a:b' }]);
    await storage.tagLinks.delete('p', 'a:b');
    await storage.tagLinks.delete('p', 'a:b');
    expect(await storage.tagLinks.list()).toEqual([{ placeId: 'p:a', tagId: 'b' }]);
    await expect(storage.tagLinks.save({ placeId: 'p', tagId: 'missing' })).rejects.toThrow('Tag');
  });

  it('removes a deleted tag from links and the saved filter while preserving unrelated data', async () => {
    await storage.tags.save(custom);
    const builtinId = BUILTIN_TAGS[0].id;
    await storage.tagLinks.save({ placeId: 'p1', tagId: custom.id });
    await storage.tagLinks.save({ placeId: 'p2', tagId: custom.id });
    await storage.tagLinks.save({ placeId: 'p1', tagId: builtinId });
    await storage.filter.save({ labelIds: ['label-1'], tagIds: [custom.id, builtinId] });
    await storage.tags.delete(custom.id);
    expect(await storage.tagLinks.list()).toEqual([{ placeId: 'p1', tagId: builtinId }]);
    expect(await storage.filter.get()).toEqual({ labelIds: ['label-1'], tagIds: [builtinId] });
  });

  it('saves, replaces and clears the current destination', async () => {
    expect(await storage.destination.get()).toBeNull();
    await storage.destination.save({ placeId: 'p1' });
    expect(await storage.destination.get()).toEqual({ placeId: 'p1' });
    await storage.destination.save({ placeId: 'p2' });
    expect(await storage.destination.get()).toEqual({ placeId: 'p2' });
    await storage.destination.clear();
    expect(await storage.destination.get()).toBeNull();
  });

  it('saves and clears the filter and does not share array references', async () => {
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
    const filter: FilterState = { labelIds: ['label-1'], tagIds: [BUILTIN_TAGS[0].id] };
    await storage.filter.save(filter);
    filter.labelIds.push('outside');
    const loaded = await storage.filter.get();
    expect(loaded.labelIds).toEqual(['label-1']);
    loaded.tagIds.push('outside');
    expect((await storage.filter.get()).tagIds).toEqual([BUILTIN_TAGS[0].id]);
    await storage.filter.clear();
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
  });

  it('saves, reads, replaces and deletes proofs independently from public stamps', async () => {
    await storage.proofs.save(proof);
    await storage.proofs.save({ ...proof, stampId: 'stamp-2' });
    expect(await storage.proofs.get(proof.stampId)).toEqual(proof);
    expect(await storage.proofs.list()).toHaveLength(2);
    await storage.proofs.save({ ...proof, proof: 'replacement' });
    expect((await storage.proofs.get(proof.stampId))?.proof).toBe('replacement');
    await storage.proofs.delete(proof.stampId);
    expect(await storage.proofs.get(proof.stampId)).toBeUndefined();
    expect(await storage.proofs.list()).toHaveLength(1);
  });

  it('stores all four typed caches with their cursors and nested geometry', async () => {
    await storage.cache.save('places', { items: lists.places, cursor: '120' });
    await storage.cache.save('stamps', { items: lists.stamps, cursor: '121' });
    await storage.cache.save('landmarks', { items: lists.landmarks });
    await storage.cache.save('labels', { items: lists.labels });
    expect(await storage.cache.get('places')).toEqual({ items: [place], cursor: '120' });
    expect(await storage.cache.get('stamps')).toEqual({ items: [stamp], cursor: '121' });
    expect(await storage.cache.get('landmarks')).toEqual({ items: [landmark] });
    expect(await storage.cache.get('labels')).toEqual({ items: [label] });
    await storage.cache.save('places', { items: [], cursor: '122' });
    expect(await storage.cache.get('places')).toEqual({ items: [], cursor: '122' });
    for (const key of ['places', 'stamps', 'landmarks', 'labels'] as const) {
      await storage.cache.delete(key);
      expect(await storage.cache.get(key)).toBeUndefined();
    }
    expect(await storage.proofs.list()).toEqual([]);
  });

  it('saves and deletes arbitrary meta keys, preserving null/false/zero and structured values', async () => {
    for (const [key, value] of Object.entries({ headingOffset: 0, enabled: false, nullable: null, cursor: '123', extra: { angle: 12, samples: [1, 2] } })) {
      await storage.meta.save(key, value);
      expect(await storage.meta.get(key)).toEqual(value);
      await storage.meta.delete(key);
      expect(await storage.meta.get(key)).toBeUndefined();
    }
  });

  it('serializes concurrent modifications so tag deletion cannot leave dangling links', async () => {
    await storage.tags.save(custom);
    await Promise.all([
      storage.tagLinks.save({ placeId: 'p', tagId: custom.id }),
      storage.filter.save({ labelIds: [], tagIds: [custom.id] }),
      storage.tags.delete(custom.id),
    ]);
    expect(await storage.tagLinks.list()).toEqual([]);
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
  });
});

describe('IndexedDB schema and lifecycle', () => {
  it('uses the exact database version, store names, and keys from the contract', async () => {
    const storage = await open();
    await storage.destination.save({ placeId: 'p' });
    await storage.filter.save({ labelIds: [], tagIds: [] });
    await storage.proofs.save(proof);
    const db = await inspectDatabase();
    try {
      expect(db.name).toBe('nasvi');
      expect(db.version).toBe(1);
      expect(Array.from(db.objectStoreNames).sort()).toEqual([...STORE_NAMES].sort());
      const tx = db.transaction([...STORE_NAMES]);
      expect(tx.objectStore('tags').keyPath).toBe('id');
      expect(tx.objectStore('tagLinks').keyPath).toEqual(['placeId', 'tagId']);
      expect(tx.objectStore('proofs').keyPath).toBe('stampId');
      const keys = (store: string) => new Promise<IDBValidKey[]>((resolve, reject) => {
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const results = await Promise.all([keys('destination'), keys('filter'), keys('proofs')]);
      expect(results).toEqual([['current'], ['current'], ['stamp-1']]);
    } finally { db.close(); }
  });

  it('persists every repository across closing/reopening without duplicating builtin tags', async () => {
    const first = await open();
    await first.tags.save(custom);
    await first.tagLinks.save({ placeId: 'p', tagId: custom.id });
    await first.destination.save({ placeId: 'p' });
    await first.filter.save({ labelIds: ['label-1'], tagIds: [custom.id] });
    await first.proofs.save(proof);
    await first.cache.save('places', { items: [place], cursor: '99' });
    await first.meta.save('headingOffset', 25);
    await first.close();
    const second = await open();
    expect(await second.tags.list()).toHaveLength(3);
    expect(await second.tags.get(custom.id)).toEqual(custom);
    expect(await second.tagLinks.list()).toEqual([{ placeId: 'p', tagId: custom.id }]);
    expect(await second.destination.get()).toEqual({ placeId: 'p' });
    expect(await second.filter.get()).toEqual({ labelIds: ['label-1'], tagIds: [custom.id] });
    expect(await second.proofs.get(proof.stampId)).toEqual(proof);
    expect(await second.cache.get('places')).toEqual({ items: [place], cursor: '99' });
    expect(await second.meta.get('headingOffset')).toBe(25);
  });

  it('keeps explicit memory instances isolated', async () => {
    const first = await open(true);
    const second = await open(true);
    await first.meta.save('offset', 10);
    expect(await second.meta.get('offset')).toBeUndefined();
  });

  it('finishes queued writes before close and rejects subsequent operations', async () => {
    const storage = await open();
    const writing = storage.meta.save('offset', 30);
    await storage.close();
    await writing;
    await expect(storage.meta.get('offset')).rejects.toThrow('closed');
    expect(await (await open()).meta.get('offset')).toBe(30);
  });

  it('shares the app instance and recreates it after close', async () => {
    const first = getStorage();
    expect(getStorage()).toBe(first);
    const storage = await first;
    instances.push(storage);
    await storage.meta.save('offset', 45);
    await storage.close();
    const next = await getStorage();
    instances.push(next);
    expect(next).not.toBe(storage);
    expect(await next.meta.get('offset')).toBe(45);
  });
});

describe('validation and pruning', () => {
  it.each([false, true])('validates destination/filter references and prunes expired proofs (memory=%s)', async memory => {
    const storage = await createStorage({ memory });
    instances.push(storage);
    await expect(storage.filter.save({ labelIds: [], tagIds: ['missing'] })).rejects.toThrow();
    await storage.filter.save({ labelIds: [], tagIds: ['favorite'] });
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: ['favorite'] });
    await storage.cache.save('places', { items: [place], cursor: '1' });
    await expect(storage.destination.save({ placeId: 'missing' })).rejects.toThrow();
    await storage.destination.save({ placeId: place.id });
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
    await storage.proofs.save({ stampId: 'old', proof: 'a', expiresAt: '2026-11-24T01:00:00Z' });
    await storage.proofs.save({ stampId: 'new', proof: 'b', expiresAt: '2026-11-24T09:00:00Z' });
    expect(await storage.proofs.pruneExpired(Date.parse('2026-11-24T05:00:00Z'))).toBe(1);
    expect((await storage.proofs.list()).map(p => p.stampId)).toEqual(['new']);
  });
});

describe('fallback', () => {
  it('works when IndexedDB is absent', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const storage = await open();
    expect(storage.mode).toBe('memory');
    await storage.destination.save({ placeId: 'p' });
    expect(await storage.destination.get()).toEqual({ placeId: 'p' });
    await storage.destination.clear();
    expect(await storage.destination.get()).toBeNull();
  });

  it('works when opening synchronously throws (e.g. private browsing restrictions)', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    const storage = await open();
    expect(storage.mode).toBe('memory');
    await storage.proofs.save(proof);
    expect(await storage.proofs.get(proof.stampId)).toEqual(proof);
    await storage.proofs.delete(proof.stampId);
    expect(await storage.proofs.get(proof.stampId)).toBeUndefined();
  });

  it('falls back on an asynchronous open error', async () => {
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION + 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    newer.close();
    const storage = await open();
    expect(storage.mode).toBe('memory');
    expect(await storage.tags.list()).toHaveLength(2);
  });

  it('times out blocked opens, then moves memory contents into the late-opened database and announces it', async () => {
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION + 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const deletion = indexedDB.deleteDatabase(DB_NAME);
    const deleting = new Promise<void>((resolve, reject) => {
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
    });
    const storage = await createStorage({ openTimeoutMs: 10 });
    instances.push(storage);
    expect(storage.mode).toBe('memory');
    const modes: string[] = [];
    const lost = vi.fn();
    storage.onModeChange(mode => modes.push(mode));
    storage.onWriteNotPersisted(lost);
    await storage.tags.save(custom);
    expect(lost).toHaveBeenCalledTimes(1);
    await storage.tags.list();
    expect(lost).toHaveBeenCalledTimes(1);
    blocker.close();
    await deleting;
    await vi.waitFor(() => expect(modes).toEqual(['indexeddb']));
    expect(storage.mode).toBe('indexeddb');
    expect(await storage.tags.get(custom.id)).toEqual(custom);
    await storage.close();
    const reopened = await open();
    expect(reopened.mode).toBe('indexeddb');
    expect(await reopened.tags.get(custom.id)).toEqual(custom);
  });

  it('announces a fallback to memory and stops announcing after unsubscribe', async () => {
    const storage = await open();
    const modes: string[] = [];
    const lost = vi.fn();
    const off = storage.onModeChange(mode => modes.push(mode));
    storage.onWriteNotPersisted(lost);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await storage.meta.save('k', 1);
    put.mockRestore();
    expect(modes).toEqual(['memory']);
    expect(lost).toHaveBeenCalledTimes(1);
    off();
    await storage.meta.save('k', 2);
    expect(modes).toEqual(['memory']);
    expect(lost).toHaveBeenCalledTimes(2);
  });

  it('falls back after a write failure and keeps previously loaded records', async () => {
    const first = await open();
    await first.tags.save(custom);
    await first.proofs.save(proof);
    await first.cache.save('stamps', { items: [stamp], cursor: '9' });
    await first.close();
    const storage = await open();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await storage.destination.save({ placeId: 'new' });
    put.mockRestore();
    expect(storage.mode).toBe('memory');
    expect(await storage.destination.get()).toEqual({ placeId: 'new' });
    expect(await storage.tags.get(custom.id)).toEqual(custom);
    expect(await storage.proofs.get(proof.stampId)).toEqual(proof);
    expect(await storage.cache.get('stamps')).toEqual({ items: [stamp], cursor: '9' });
    await storage.proofs.delete(proof.stampId);
    expect(await storage.proofs.get(proof.stampId)).toBeUndefined();
  });

  it('falls back when the seed transaction cannot write', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const storage = await open();
    expect(storage.mode).toBe('memory');
    expect(await storage.tags.list()).toHaveLength(2);
    await storage.tags.save(custom);
    expect(await storage.tags.get(custom.id)).toEqual(custom);
  });

  it('replays asynchronous transaction aborts in memory', async () => {
    const storage = await open();
    await storage.proofs.save(proof);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value, key) {
      const req = key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
      this.transaction.abort();
      return req;
    });
    await storage.meta.save('offset', 12);
    expect(storage.mode).toBe('memory');
    expect(await storage.meta.get('offset')).toBe(12);
    expect(await storage.proofs.get(proof.stampId)).toEqual(proof);
  });

  it('retains the last snapshot when a read transaction becomes unavailable', async () => {
    const storage = await open();
    await storage.destination.save({ placeId: 'p' });
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
      throw new DOMException('Closed unexpectedly', 'InvalidStateError');
    });
    expect(await storage.destination.get()).toEqual({ placeId: 'p' });
    expect(storage.mode).toBe('memory');
  });

  it('rolls back a failed multi-store write before replaying it in memory', async () => {
    const storage = await open();
    await storage.tags.save(custom);
    await storage.tagLinks.save({ placeId: 'p', tagId: custom.id });
    await storage.filter.save({ labelIds: [], tagIds: [custom.id] });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Unavailable', 'UnknownError');
    });
    await storage.tags.delete(custom.id);
    expect(storage.mode).toBe('memory');
    expect(await storage.tags.get(custom.id)).toBeUndefined();
    expect(await storage.tagLinks.list()).toEqual([]);
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
    vi.restoreAllMocks();
    const persisted = await open();
    expect(await persisted.tags.get(custom.id)).toEqual(custom);
    expect(await persisted.tagLinks.list()).toHaveLength(1);
    expect((await persisted.filter.get()).tagIds).toEqual([custom.id]);
  });

  it('surfaces programming/serialization errors without switching storage modes', async () => {
    const storage = await open();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Not cloneable', 'DataCloneError');
    });
    await expect(storage.meta.save('bad', 1)).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(storage.mode).toBe('indexeddb');
    expect(await storage.meta.get('bad')).toBeUndefined();
    await storage.meta.save('good', 2);
    expect(await storage.meta.get('good')).toBe(2);
  });
});
