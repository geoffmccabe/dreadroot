// mapPersistence — the SINGLE entry point for loading/saving a map's authored content
// (terrain heightfield + water, later object placements). Backed by IndexedDB locally
// for now so maps survive reloads during development. Per docs/NAMED_WORLDS_PERSISTENCE.md
// the real home is a `worlds` row written through server-validated RPCs (worldStore) —
// when that lands, ONLY this file changes; callers (HeightmapTerrain load, panel Save)
// stay the same. Keyed by map id (= world id).

export interface MapSaveData {
  id: string;
  name?: string;
  savedAt?: number;
  version: number;
  heightField: { baseY: number; samples: number[] };
  water: { on: boolean; level: number };
}

const DB_NAME = 'siege-maps';
const STORE = 'maps';
const SAVE_VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export async function saveMap(data: Omit<MapSaveData, 'version' | 'savedAt'>): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...data, version: SAVE_VERSION, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* persistence is best-effort during dev */ }
}

export async function loadMap(id: string): Promise<MapSaveData | null> {
  try {
    const d = await db();
    return await new Promise<MapSaveData | null>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as MapSaveData) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}
