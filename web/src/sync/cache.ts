import type { Label, Landmark, Place, Stamp } from '../types';
import { isExpired } from '../domain/stamps';

export interface Snapshot {
  places: Place[];
  stamps: Stamp[];
  landmarks: Landmark[];
  labels: Label[];
  cursor: string | null;
  cursors: Record<CacheKey, string | null>;
}

export type CacheKey = 'places' | 'stamps' | 'landmarks' | 'labels';
export const cacheKeys: readonly CacheKey[] = ['places', 'stamps', 'landmarks', 'labels'];

export interface CacheOptions {
  now?: () => Date | number;
}

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

function createState(store: CacheStore) {
  return { store, generation: 0, writes: Promise.resolve() };
}

let cacheState = createState(createMemoryStore());

/** 引数を省略すると、空のメモリ保存先に戻す。 */
export function setCacheStore(store: CacheStore = createMemoryStore()): void {
  cacheState = createState(store);
}

function normalizeCursor(cursor: unknown): string | null {
  return typeof cursor === 'string' && /^-?\d+$/.test(cursor) ? cursor : null;
}

/** 取りこぼしを避けるため、両方の cursor があるときだけ古い方を使う。 */
export function pickCursor(
  placesCursor: string | null | undefined,
  stampsCursor: string | null | undefined,
): string | null {
  if (placesCursor == null || stampsCursor == null) return null;
  if (normalizeCursor(placesCursor) === null || normalizeCursor(stampsCursor) === null) return null;
  return BigInt(placesCursor) <= BigInt(stampsCursor) ? placesCursor : stampsCursor;
}

/** 保存先や通信の境界で、一覧の形と cursor を検査する。 */
export function normalizeCacheEntry<K extends CacheKey>(key: K, entry: unknown, now: Date | number): CacheEntry<K> | undefined {
  if (typeof entry !== 'object' || entry === null || !('value' in entry)
    || !Array.isArray(entry.value)) return undefined;
  let value = entry.value;
  if (key === 'stamps') {
    if (!value.every((stamp) => stamp !== null && typeof stamp === 'object'
      && typeof stamp.expiresAt === 'string' && Number.isFinite(Date.parse(stamp.expiresAt)))) return undefined;
    value = value.filter((stamp: Stamp) => !isExpired(stamp, now));
  }
  return {
    value,
    cursor: normalizeCursor('cursor' in entry ? entry.cursor : null),
  } as CacheEntry<K>;
}

/** 壊れたキーだけを無視する。1 キーでも読めれば残りは空の一覧として返す。 */
export async function loadSnapshot(options: CacheOptions = {}): Promise<Snapshot | null> {
  const { store } = cacheState;
  const now = (options.now ?? Date.now)();
  const results = await Promise.allSettled(cacheKeys.map(async (key) =>
    normalizeCacheEntry(key, await store.get(key), now)));
  const entries: Partial<CacheEntries> = {};
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      Object.assign(entries, { [cacheKeys[index]]: result.value });
    }
  });
  const { places, stamps, landmarks, labels } = entries;
  if (!places && !stamps && !landmarks && !labels) return null;
  return {
    places: places?.value ?? [],
    stamps: stamps?.value ?? [],
    landmarks: landmarks?.value ?? [],
    labels: labels?.value ?? [],
    cursors: {
      places: places?.cursor ?? null, stamps: stamps?.cursor ?? null,
      landmarks: landmarks?.cursor ?? null, labels: labels?.cursor ?? null,
    },
    cursor: pickCursor(places?.cursor, stamps?.cursor),
  };
}

/** 取得開始時に予約する。古い世代は保存せず、進行中の set と新しい保存も直列化する。 */
export function createSnapshotWriter(options: CacheOptions = {}) {
  const state = cacheState;
  const generation = ++state.generation;
  return async (snapshot: Snapshot, keys: readonly CacheKey[] = cacheKeys): Promise<void> => {
    const pending = state.writes.then(async () => {
      if (generation !== state.generation) return;
      const now = (options.now ?? Date.now)();
      await Promise.allSettled(keys.map(async (key) => {
        const entry = normalizeCacheEntry(key, { value: snapshot[key], cursor: snapshot.cursors[key] }, now);
        if (entry) await state.store.set(key, entry);
      }));
    });
    state.writes = pending.catch(() => {});
    await pending;
  };
}

/** 保存不能なキーがあっても、ほかのキーの保存を続ける。 */
export async function saveSnapshot(snapshot: Snapshot, options: CacheOptions = {}): Promise<void> {
  await createSnapshotWriter(options)(snapshot);
}
