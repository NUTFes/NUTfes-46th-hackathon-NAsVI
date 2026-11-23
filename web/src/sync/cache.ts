import type { Label, Landmark, Place, Stamp } from '../types';

export interface Snapshot {
  places: Place[];
  stamps: Stamp[];
  landmarks: Landmark[];
  labels: Label[];
  cursor: string | null;
}

export type CacheKey = 'places' | 'stamps' | 'landmarks' | 'labels';

type CacheEntries = {
  [K in CacheKey]: { value: Snapshot[K]; cursor: string | null };
};

export type CacheEntry<K extends CacheKey> = CacheEntries[K];

export interface CacheStore {
  get<K extends CacheKey>(key: K): Promise<CacheEntry<K> | undefined>;
  set<K extends CacheKey>(key: K, entry: CacheEntry<K>): Promise<void>;
}

function createMemoryStore(): CacheStore {
  const entries: Partial<CacheEntries> = {};
  return {
    async get(key) {
      const entry = entries[key];
      return entry === undefined ? undefined : structuredClone(entry);
    },
    async set(key, entry) {
      entries[key] = structuredClone(entry);
    },
  };
}

let cacheStore: CacheStore = createMemoryStore();

/** 引数を省略すると、空のメモリ保存先に戻す。 */
export function setCacheStore(store: CacheStore = createMemoryStore()): void {
  cacheStore = store;
}

/** 取りこぼしを避けるため、両方の cursor があるときだけ古い方を使う。 */
export function pickCursor(
  placesCursor: string | null | undefined,
  stampsCursor: string | null | undefined,
): string | null {
  if (placesCursor == null || stampsCursor == null) return null;
  if (!/^-?\d+$/.test(placesCursor) || !/^-?\d+$/.test(stampsCursor)) return null;
  return BigInt(placesCursor) <= BigInt(stampsCursor) ? placesCursor : stampsCursor;
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  const store = cacheStore;
  const [places, stamps, landmarks, labels] = await Promise.all([
    store.get('places'),
    store.get('stamps'),
    store.get('landmarks'),
    store.get('labels'),
  ]);
  if (!places || !stamps || !landmarks || !labels) return null;
  return {
    places: places.value,
    stamps: stamps.value,
    landmarks: landmarks.value,
    labels: labels.value,
    cursor: pickCursor(places.cursor, stamps.cursor),
  };
}

export async function saveSnapshot(s: Snapshot): Promise<void> {
  const store = cacheStore;
  await Promise.all([
    store.set('places', { value: s.places, cursor: s.cursor }),
    store.set('stamps', { value: s.stamps, cursor: s.cursor }),
    store.set('landmarks', { value: s.landmarks, cursor: s.cursor }),
    store.set('labels', { value: s.labels, cursor: s.cursor }),
  ]);
}
