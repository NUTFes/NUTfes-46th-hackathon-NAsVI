import { STORE_NAMES, type StorageKeys, type StorageTransaction, type StorageValues, type StoreName } from './schema';

type Records = Map<string, unknown>;

/** Copy-on-write snapshots give memory transactions the same rollback/clone behavior as IDB. */
export class MemoryStorage implements StorageTransaction {
  private readonly records: Map<StoreName, Records>;

  constructor(source?: MemoryStorage) {
    this.records = new Map(STORE_NAMES.map(name => [name, new Map(source?.records.get(name))]));
  }

  async get<K extends StoreName>(store: K, key: StorageKeys[K]): Promise<StorageValues[K] | undefined> {
    return structuredClone(this.records.get(store)!.get(JSON.stringify(key))) as StorageValues[K] | undefined;
  }

  async all<K extends StoreName>(store: K): Promise<StorageValues[K][]> {
    return structuredClone([...this.records.get(store)!.values()]) as StorageValues[K][];
  }

  async put<K extends StoreName>(store: K, key: StorageKeys[K], value: StorageValues[K]): Promise<void> {
    this.records.get(store)!.set(JSON.stringify(key), structuredClone(value));
  }

  async delete<K extends StoreName>(store: K, key: StorageKeys[K]): Promise<void> {
    this.records.get(store)!.delete(JSON.stringify(key));
  }

  entries<K extends StoreName>(store: K): [StorageKeys[K], StorageValues[K]][] {
    return [...this.records.get(store)!].map(([key, value]) =>
      [JSON.parse(key), structuredClone(value)] as [StorageKeys[K], StorageValues[K]]);
  }

  replace<K extends StoreName>(store: K, keys: StorageKeys[K][], values: StorageValues[K][]): void {
    this.records.set(store, new Map(keys.map((key, i) => [JSON.stringify(key), structuredClone(values[i])])));
  }
}
