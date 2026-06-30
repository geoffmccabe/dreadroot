// siegeWorldCache — IndexedDB cache for Siege Worlds PROCESSED assets (unpacked geometry, prebuilt
// colliders, raw bytes). SWW startup is dominated by per-load CPU work — draco-decoding ~700 model
// files and (re)building their collision shapes EVERY load — which plain HTTP/byte caching can't
// help (the bytes are already cached; the decode + build are not). This stores the FINISHED results
// so repeat visits skip that work, the same way Dreadroot persists its built texture atlas + chunks.
//
// Design (mirrors blockDB/atlasManager): versioned, fully fail-safe (any error → cache miss, never
// breaks the load), keyed by a content signature so a re-exported asset auto-invalidates.
import * as THREE from 'three';

const DB_NAME = 'sww-world-cache';
const DB_VERSION = 1;
// Bump to invalidate EVERY cached SWW asset at once (format change / processing change). Distinct
// from APP_VERSION — only bump when the SHAPE of what we store, or how we build it, changes.
export const SWW_CACHE_VERSION = 3;   // v3: wipe caches that still held the embedded-texture models (Portal/Gate, Forge) so they re-decode

const STORES = ['geometry', 'colliders', 'bytes'] as const;
export type SwwStore = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
      };
      req.onsuccess = () => { resolve(req.result); pruneOldVersions(req.result); };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

// Keys are namespaced by cache version, so bumping SWW_CACHE_VERSION makes every old entry a miss.
const vkey = (id: string) => `${SWW_CACHE_VERSION}:${id}`;
const isCurrent = (key: string) => key.startsWith(`${SWW_CACHE_VERSION}:`);

interface Rec { key: string; data: unknown; cachedAt: number }

export async function swwCacheGet<T>(store: SwwStore, id: string): Promise<T | null> {
  const db = await open(); if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).get(vkey(id));
      req.onsuccess = () => resolve(((req.result as Rec | undefined)?.data as T) ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function swwCachePut(store: SwwStore, id: string, data: unknown): Promise<void> {
  const db = await open(); if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put({ key: vkey(id), data, cachedAt: Date.now() } as Rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

// All current-version ids in a store — used to build a synchronous "is this cached?" index up front.
export async function swwCacheKeys(store: SwwStore): Promise<string[]> {
  const db = await open(); if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
      const pfx = `${SWW_CACHE_VERSION}:`;
      req.onsuccess = () => resolve(
        (req.result as IDBValidKey[])
          .filter((k): k is string => typeof k === 'string' && k.startsWith(pfx))
          .map((k) => k.slice(pfx.length)),
      );
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

// Background cleanup: drop entries from a previous SWW_CACHE_VERSION so the DB doesn't grow forever.
function pruneOldVersions(db: IDBDatabase) {
  try {
    for (const s of STORES) {
      const tx = db.transaction(s, 'readwrite');
      const store = tx.objectStore(s);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        if (typeof cur.key === 'string' && !isCurrent(cur.key)) cur.delete();
        cur.continue();
      };
    }
  } catch { /* best-effort */ }
}

// ── THREE geometry (de)serialization — shared by terrain (Stage 1) + world objects (Stage 2) ──
// Typed arrays survive structured-clone into IndexedDB unchanged, so we store them directly and
// rebuild a BufferGeometry on read (no draco decode, no normal/UV recompute).
export interface SerGeo {
  attrs: Record<string, { array: ArrayLike<number>; itemSize: number; normalized: boolean }>;
  index: ArrayLike<number> | null;
  groups?: { start: number; count: number; materialIndex?: number }[];
}

export function serializeGeometry(geo: THREE.BufferGeometry): SerGeo {
  const attrs: SerGeo['attrs'] = {};
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name] as THREE.BufferAttribute;
    attrs[name] = { array: a.array as ArrayLike<number>, itemSize: a.itemSize, normalized: a.normalized };
  }
  // Multi-material meshes map index ranges → materials via groups; preserve them or sub-meshes
  // would all render with material 0.
  const groups = geo.groups && geo.groups.length ? geo.groups.map((g) => ({ start: g.start, count: g.count, materialIndex: g.materialIndex })) : undefined;
  return { attrs, index: geo.index ? (geo.index.array as ArrayLike<number>) : null, groups };
}

export function deserializeGeometry(s: SerGeo): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(s.attrs)) {
    const a = s.attrs[name];
    g.setAttribute(name, new THREE.BufferAttribute(a.array as THREE.TypedArray, a.itemSize, a.normalized));
  }
  if (s.index) g.setIndex(new THREE.BufferAttribute(s.index as THREE.TypedArray, 1));
  if (s.groups) for (const gr of s.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeBoundingSphere();
  return g;
}
