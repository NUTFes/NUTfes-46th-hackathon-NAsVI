import { MemoryStorage } from './memory';
import {
  DB_NAME, DB_VERSION, STORE_NAMES,
  type StorageKeys, type StorageTransaction, type StorageValues, type StoreName,
} from './schema';

export interface StorageOptions {
  /** Explicitly request an isolated, nonpersistent instance. */
  memory?: boolean;
  /** Also limits an open request blocked by another tab. Default: 1000 ms. */
  openTimeoutMs?: number;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Storage transaction aborted', 'AbortError'));
  });
  // A request can reject before the caller gets to await completion.
  void done.catch(() => {});
  return done;
}

function openDatabase(timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new DOMException('Opening storage timed out', 'TimeoutError'));
    }, timeoutMs);
    let opening: IDBOpenDBRequest;
    try {
      opening = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    opening.onupgradeneeded = () => {
      // A late request must not create an unused database after memory fallback.
      if (settled) { opening.transaction?.abort(); return; }
      const db = opening.result;
      db.createObjectStore('tags', { keyPath: 'id' });
      db.createObjectStore('tagLinks', { keyPath: ['placeId', 'tagId'] });
      db.createObjectStore('destination');
      db.createObjectStore('filter');
      db.createObjectStore('proofs', { keyPath: 'stampId' });
      db.createObjectStore('cache');
      db.createObjectStore('meta');
    };
    opening.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { opening.result.close(); return; }
      settled = true;
      const db = opening.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    opening.onerror = () => {
      clearTimeout(timer);
      settled = true;
      reject(opening.error);
    };
  });
}

function unavailable(error: unknown): boolean {
  return error instanceof Error && [
    'SecurityError', 'InvalidStateError', 'QuotaExceededError', 'UnknownError',
    'AbortError', 'NotReadableError', 'TimeoutError',
  ].includes(error.name);
}

/** Serializes local operations and retains a last-known snapshot for runtime fallback. */
export class StorageDatabase {
  private memory = new MemoryStorage();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(private db?: IDBDatabase) {}

  static async open(options: StorageOptions = {}): Promise<StorageDatabase> {
    if (options.memory) return new StorageDatabase();
    let db: IDBDatabase | undefined;
    try {
      db = await openDatabase(options.openTimeoutMs ?? 1000);
      const result = new StorageDatabase(db);
      const tx = db.transaction([...STORE_NAMES], 'readonly');
      const done = completed(tx);
      // Warm the fallback snapshot, including records saved in earlier sessions.
      await Promise.all(STORE_NAMES.map(async store => {
        const objectStore = tx.objectStore(store);
        const [keys, values] = await Promise.all([request(objectStore.getAllKeys()), request(objectStore.getAll())]);
        result.memory.replace(store, keys as StorageKeys[typeof store][], values);
      }));
      await done;
      return result;
    } catch {
      db?.close();
      return new StorageDatabase();
    }
  }

  get mode(): 'indexeddb' | 'memory' { return this.db ? 'indexeddb' : 'memory'; }

  run<T>(mode: IDBTransactionMode, action: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Storage is closed'));
    const operation = this.queue.then(async () => {
      if (this.db) {
        try {
          return await this.persistent(mode, action);
        } catch (error) {
          // Programming/validation errors (including DataCloneError) must surface.
          if (!unavailable(error)) throw error;
          this.db.close();
          this.db = undefined;
        }
      }
      const snapshot = new MemoryStorage(this.memory);
      const result = await action(snapshot);
      this.memory = snapshot;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async persistent<T>(mode: IDBTransactionMode, action: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    const tx = this.db!.transaction([...STORE_NAMES], mode);
    const done = completed(tx);
    const snapshot = new MemoryStorage(this.memory);
    const adapter: StorageTransaction = {
      get: async <K extends StoreName>(store: K, key: StorageKeys[K]) => {
        const value = await request<StorageValues[K] | undefined>(tx.objectStore(store).get(key));
        if (value === undefined) await snapshot.delete(store, key);
        else await snapshot.put(store, key, value);
        return value;
      },
      all: async <K extends StoreName>(store: K) => {
        const objectStore = tx.objectStore(store);
        const [keys, values] = await Promise.all([request(objectStore.getAllKeys()), request<StorageValues[K][]>(objectStore.getAll())]);
        snapshot.replace(store, keys as StorageKeys[K][], values);
        return values;
      },
      put: async <K extends StoreName>(store: K, key: StorageKeys[K], value: StorageValues[K]) => {
        const objectStore = tx.objectStore(store);
        await request(objectStore.keyPath === null ? objectStore.put(value, key) : objectStore.put(value));
        await snapshot.put(store, key, value);
      },
      delete: async (store, key) => {
        await request(tx.objectStore(store).delete(key));
        await snapshot.delete(store, key);
      },
    };
    try {
      const result = await action(adapter);
      await done;
      this.memory = snapshot;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* It may already have aborted/completed. */ }
      await done.catch(() => {});
      throw error;
    }
  }

  /** Waits for queued operations before releasing the connection. */
  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    this.db?.close();
  }
}
