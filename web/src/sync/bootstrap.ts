import { apiGet } from '../api/client';
import { isExpired } from '../domain/stamps';
import {
  cacheKeys, createSnapshotWriter, loadSnapshot, normalizeCacheEntry, pickCursor,
  type CacheKey, type CacheOptions, type Snapshot,
} from './cache';

export interface BootstrapResult {
  snapshot: Snapshot;
  failedKeys: CacheKey[];
}

export interface CachedBootstrap {
  snapshot: Snapshot;
  updated: Promise<BootstrapResult>;
}

const fetchers = {
  places: () => apiGet('/places'),
  stamps: () => apiGet('/stamps'),
  landmarks: () => apiGet('/landmarks'),
  labels: () => apiGet('/labels'),
};

async function refresh(
  keys: readonly CacheKey[],
  cached: Promise<Snapshot | null>,
  write: ReturnType<typeof createSnapshotWriter>,
  options: CacheOptions,
): Promise<BootstrapResult> {
  // cursor が無い・不正な場合も含め、resync は since を付けずに全件取得する。
  const results = await Promise.allSettled(keys.map(async (key) => {
    const response = await fetchers[key]();
    const entry = normalizeCacheEntry(key, {
      value: response.items, cursor: 'cursor' in response ? response.cursor : null,
    }, (options.now ?? Date.now)());
    if (!entry) throw new TypeError(`Invalid ${key} list`);
    return entry;
  }));
  const previous = await cached;
  const snapshot: Snapshot = {
    places: previous?.places ?? [], stamps: previous?.stamps ?? [],
    landmarks: previous?.landmarks ?? [], labels: previous?.labels ?? [],
    cursor: null,
    cursors: { places: null, stamps: null, landmarks: null, labels: null, ...previous?.cursors },
  };
  const failedKeys: CacheKey[] = [];
  const succeeded: CacheKey[] = [];
  results.forEach((result, index) => {
    const key = keys[index];
    if (result.status === 'rejected') {
      failedKeys.push(key);
      return;
    }
    const entry = result.value;
    Object.assign(snapshot, { [key]: entry.value });
    snapshot.cursors[key] = entry.cursor;
    succeeded.push(key);
  });
  const now = (options.now ?? Date.now)();
  snapshot.stamps = snapshot.stamps.filter((stamp) => !isExpired(stamp, now));
  snapshot.cursor = pickCursor(snapshot.cursors.places, snapshot.cursors.stamps);
  // 失敗した一覧は保存せず、元のキャッシュと cursor を保つ。
  await write(snapshot, succeeded);
  return { snapshot, failedKeys };
}

/** 初回・resync。成功した一覧を返し、失敗キーは retryBootstrap に渡せる。 */
export function bootstrap(options: CacheOptions = {}): Promise<BootstrapResult> {
  const write = createSnapshotWriter(options);
  return refresh(cacheKeys, loadSnapshot(options), write, options);
}

/** 失敗した一覧だけを全件取得し直す。ほかのキーはキャッシュから使う。 */
export function retryBootstrap(keys: readonly CacheKey[], options: CacheOptions = {}): Promise<BootstrapResult> {
  const write = createSnapshotWriter(options);
  return refresh([...new Set(keys)], loadSnapshot(options), write, options);
}

/** キャッシュを先に返す。updated の成功結果で表示を差し替え、失敗時はキャッシュを保つ。 */
export async function loadCachedOrFetch(options: CacheOptions = {}): Promise<CachedBootstrap> {
  const write = createSnapshotWriter(options);
  const cached = await loadSnapshot(options);
  const updated = refresh(cacheKeys, Promise.resolve(cached), write, options);
  return { snapshot: cached ?? (await updated).snapshot, updated };
}
