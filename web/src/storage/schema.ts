import type { Destination, FilterState, Label, Landmark, MyTag, Place, Stamp } from '../types';

export const DB_NAME = 'nasvi';
export const DB_VERSION = 1;
export const CURRENT_KEY = 'current';
export const STORE_NAMES = ['tags', 'tagLinks', 'destination', 'filter', 'proofs', 'cache', 'meta'] as const;

// Provisional identifiers/titles: keep these centralized until product decisions are made.
export const BUILTIN_TAGS: readonly Readonly<MyTag>[] = Object.freeze([
  Object.freeze({ id: 'want-to-go', title: '行きたい場所', builtin: true }),
  Object.freeze({ id: 'favorite', title: 'お気に入り', builtin: true }),
]);

export interface TagLink { placeId: string; tagId: string }
export interface StampProof { stampId: string; proof: string; expiresAt: string }
export interface CacheItems {
  places: Place[];
  stamps: Stamp[];
  landmarks: Landmark[];
  labels: Label[];
}
export type CacheKey = keyof CacheItems;
// Only places/stamps necessarily have a cursor; preserve its absence for other lists.
export interface CacheEntry<K extends CacheKey> { items: CacheItems[K]; cursor?: string }
export type CacheValue = CacheEntry<CacheKey>;
// Metadata is deliberately limited to JSON-like values shared by both backends.
export type MetaValue = string | number | boolean | null | MetaValue[] | { [key: string]: MetaValue };

export interface StorageValues {
  tags: MyTag;
  tagLinks: TagLink;
  destination: Destination;
  filter: FilterState;
  proofs: StampProof;
  cache: CacheValue;
  meta: MetaValue;
}
export interface StorageKeys {
  tags: string;
  tagLinks: [string, string];
  destination: typeof CURRENT_KEY;
  filter: typeof CURRENT_KEY;
  proofs: string;
  cache: CacheKey;
  meta: string;
}
export type StoreName = typeof STORE_NAMES[number];

/** Internal unit of work. Repositories use only storage promises inside a transaction. */
export interface StorageTransaction {
  get<K extends StoreName>(store: K, key: StorageKeys[K]): Promise<StorageValues[K] | undefined>;
  all<K extends StoreName>(store: K): Promise<StorageValues[K][]>;
  put<K extends StoreName>(store: K, key: StorageKeys[K], value: StorageValues[K]): Promise<void>;
  delete<K extends StoreName>(store: K, key: StorageKeys[K]): Promise<void>;
}
