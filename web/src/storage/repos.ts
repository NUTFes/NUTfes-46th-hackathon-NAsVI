import type { Destination, FilterState, MyTag } from '../types';
import { StorageDatabase, type StorageOptions } from './db';
import {
  BUILTIN_TAGS, CURRENT_KEY,
  type CacheEntry, type CacheKey, type MetaValue, type StampProof, type TagLink,
} from './schema';

function repositories(db: StorageDatabase) {
  return {
    get mode() { return db.mode; },
    close: () => db.close(),
    tags: {
      list: () => db.run('readonly', tx => tx.all('tags')),
      get: (id: string) => db.run('readonly', tx => tx.get('tags', id)),
      /** IDs are supplied by the caller; builtin tags cannot be renamed or replaced. */
      save: (tag: MyTag) => db.run('readwrite', async tx => {
        if (tag.builtin || (await tx.get('tags', tag.id))?.builtin) {
          throw new Error('Builtin tags cannot be changed');
        }
        await tx.put('tags', tag.id, tag);
      }),
      /** Remove the tag, its assignments and its filter selection atomically. */
      delete: (id: string) => db.run('readwrite', async tx => {
        if ((await tx.get('tags', id))?.builtin) throw new Error('Builtin tags cannot be deleted');
        await tx.delete('tags', id);
        for (const link of await tx.all('tagLinks')) {
          if (link.tagId === id) await tx.delete('tagLinks', [link.placeId, link.tagId]);
        }
        const filter = await tx.get('filter', CURRENT_KEY);
        if (filter?.tagIds.includes(id)) {
          await tx.put('filter', CURRENT_KEY, { ...filter, tagIds: filter.tagIds.filter(tagId => tagId !== id) });
        }
      }),
    },
    tagLinks: {
      list: (placeId?: string) => db.run('readonly', async tx => {
        const links = await tx.all('tagLinks');
        return placeId === undefined ? links : links.filter(link => link.placeId === placeId);
      }),
      /** The compound key makes repeated assignment idempotent. */
      save: (link: TagLink) => db.run('readwrite', async tx => {
        if (!await tx.get('tags', link.tagId)) throw new Error('Tag does not exist');
        await tx.put('tagLinks', [link.placeId, link.tagId], link);
      }),
      delete: (placeId: string, tagId: string) => db.run('readwrite', tx => tx.delete('tagLinks', [placeId, tagId])),
    },
    destination: {
      get: () => db.run('readonly', async tx => (await tx.get('destination', CURRENT_KEY)) ?? null),
      save: (value: Destination) => db.run('readwrite', tx => tx.put('destination', CURRENT_KEY, value)),
      clear: () => db.run('readwrite', tx => tx.delete('destination', CURRENT_KEY)),
    },
    filter: {
      get: () => db.run('readonly', async tx => (await tx.get('filter', CURRENT_KEY)) ?? { labelIds: [], tagIds: [] }),
      save: (value: FilterState) => db.run('readwrite', tx => tx.put('filter', CURRENT_KEY, value)),
      clear: () => db.run('readwrite', tx => tx.delete('filter', CURRENT_KEY)),
    },
    proofs: {
      get: (stampId: string) => db.run('readonly', tx => tx.get('proofs', stampId)),
      list: () => db.run('readonly', tx => tx.all('proofs')),
      save: (value: StampProof) => db.run('readwrite', tx => tx.put('proofs', value.stampId, value)),
      delete: (stampId: string) => db.run('readwrite', tx => tx.delete('proofs', stampId)),
    },
    cache: {
      // The key determines the list type; items and cursor are stored in one record.
      get: <K extends CacheKey>(key: K) => db.run('readonly', async tx =>
        await tx.get('cache', key) as CacheEntry<K> | undefined),
      save: <K extends CacheKey>(key: K, value: CacheEntry<NoInfer<K>>) =>
        db.run('readwrite', tx => tx.put('cache', key, value)),
      delete: (key: CacheKey) => db.run('readwrite', tx => tx.delete('cache', key)),
    },
    meta: {
      get: (key: string) => db.run('readonly', tx => tx.get('meta', key)),
      save: (key: string, value: MetaValue) => db.run('readwrite', tx => tx.put('meta', key, value)),
      delete: (key: string) => db.run('readwrite', tx => tx.delete('meta', key)),
    },
  };
}

export type StorageRepositories = ReturnType<typeof repositories>;

/** Prefer getStorage() in the app so all consumers share one memory fallback. */
export async function createStorage(options: StorageOptions = {}): Promise<StorageRepositories> {
  const db = await StorageDatabase.open(options);
  try {
    await db.run('readwrite', async tx => {
      for (const tag of BUILTIN_TAGS) {
        if (!await tx.get('tags', tag.id)) await tx.put('tags', tag.id, tag);
      }
    });
    return repositories(db);
  } catch (error) {
    await db.close();
    throw error;
  }
}

let shared: Promise<StorageRepositories> | undefined;

/** Lazy initialization: importing this module does not open IndexedDB. */
export function getStorage(): Promise<StorageRepositories> {
  if (!shared) {
    const pending: Promise<StorageRepositories> = createStorage().then(storage => {
      const close = storage.close;
      storage.close = async () => {
        if (shared === pending) shared = undefined;
        await close();
      };
      return storage;
    }).catch(error => {
      if (shared === pending) shared = undefined;
      throw error;
    });
    shared = pending;
  }
  return shared;
}
