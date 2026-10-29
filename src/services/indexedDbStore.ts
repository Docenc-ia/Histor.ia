/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Asynchronous IndexedDB Key-Value Engine + Write-Through In-Memory Cache.
 * Removes the 5MB synchronous localStorage bottleneck for large histories,
 * multi-course gradebooks, and observations while maintaining 100% synchronous
 * read compatibility via an in-memory Map mirrored to localStorage and IndexedDB.
 */

const IDB_NAME = 'docencia_idb_v1';
const IDB_VERSION = 1;
const STORE_NAME = 'kv_store';

const memoryCache = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let hydrationStarted = false;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

export const indexedDbStore = {
  /**
   * Hydrates the in-memory Map from IndexedDB in the background on startup.
   * If a key exists in IndexedDB but was evicted or missing from localStorage,
   * it becomes immediately available in memoryCache for synchronous reads.
   */
  async hydrateMemoryCache(): Promise<void> {
    if (hydrationStarted || typeof window === 'undefined') return;
    hydrationStarted = true;

    const db = await openDatabase();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const cursorReq = store.openCursor();

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const key = String(cursor.key);
            const val = cursor.value;
            if (typeof val === 'string' && !memoryCache.has(key)) {
              memoryCache.set(key, val);
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        cursorReq.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },

  /**
   * Reads a value from the fast in-memory cache first.
   */
  getFromMemory(key: string): string | undefined {
    return memoryCache.get(key);
  },

  /**
   * Populates the in-memory cache and persists asynchronously to IndexedDB.
   */
  setMemoryAndIdb(key: string, value: string): void {
    memoryCache.set(key, value);
    void (async () => {
      const db = await openDatabase();
      if (!db) return;
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
      } catch (_) {}
    })();
  },

  /**
   * Removes a key from both the in-memory cache and IndexedDB.
   */
  removeMemoryAndIdb(key: string): void {
    memoryCache.delete(key);
    void (async () => {
      const db = await openDatabase();
      if (!db) return;
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
      } catch (_) {}
    })();
  },
};

// Trigger non-blocking background hydration when running in browser
if (typeof window !== 'undefined') {
  void indexedDbStore.hydrateMemoryCache();
}
