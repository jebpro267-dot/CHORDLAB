const DB_NAME = "chordlab-audio";
const STORE = "files";

/**
 * Opens or upgrades the browser's IndexedDB database used for storing raw audio Blobs.
 * IndexedDB provides asynchronous, high-capacity client-side persistence that exceeds
 * localStorage's 5MB limit and supports binary audio files directly.
 *
 * @returns Promise resolving to the opened IDBDatabase instance.
 */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Persists an audio Blob (full track or isolated stem) into IndexedDB under the specified key ID.
 * Storage operations are non-blocking and fail gracefully if quota or permissions fail.
 *
 * @param id - Unique storage key identifier (e.g. song ID or `songId::stemName`).
 * @param blob - Binary audio Blob data.
 */
export async function putAudio(id: string, blob: Blob) {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* storage is best-effort */
  }
}

/**
 * Retrieves a cached audio Blob from IndexedDB by key ID.
 *
 * @param id - Unique storage key identifier.
 * @returns Promise resolving to the audio Blob if found, or null if missing or error occurs.
 */
export async function getAudio(id: string): Promise<Blob | null> {
  try {
    const db = await open();
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Deletes a stored audio Blob from IndexedDB by key ID.
 *
 * @param id - Unique storage key identifier to remove.
 */
export async function deleteAudio(id: string) {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
  } catch {
    /* ignore */
  }
}
