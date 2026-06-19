// Save/load named Fortress Builder creations in IndexedDB (localStorage is too small
// for the image data URLs). Each snapshot stores the full builder state (params +
// source image) so it can be recalled exactly and, later, placed on the map.
const DB_NAME = 'fortress-builder';
const STORE = 'snapshots';

export interface Snapshot {
  name: string;
  createdAt: number;
  state: Record<string, unknown>; // a BuilderState minus transient fields (isOpen, blockCount)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(snap: Snapshot): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snap);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function listSnapshots(): Promise<Snapshot[]> {
  const db = await openDb();
  try {
    const all = await new Promise<Snapshot[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as Snapshot[]);
      req.onerror = () => reject(req.error);
    });
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } finally { db.close(); }
}

export async function deleteSnapshot(name: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
