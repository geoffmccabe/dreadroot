// mapPersistence — the SINGLE entry point for loading/saving a map's authored content
// (terrain heightfield + water, later object placements). Backed by IndexedDB locally
// for now so maps survive reloads during development. Per docs/NAMED_WORLDS_PERSISTENCE.md
// the real home is a `worlds` row written through server-validated RPCs (worldStore) —
// when that lands, ONLY this file changes; callers (HeightmapTerrain load, panel Save)
// stay the same. Keyed by map id (= world id).

import type { PlacedObject } from '../builder/builderObjectsState';
import { supabase } from '@/integrations/supabase/client';
import { LEGACY_MAP_IDS } from '@/config/worldDefinition';

// Old → new map ids, so a sculpt saved before a map was renamed still loads. Inverted from the
// canonical table in worldDefinition so there is only ONE place renames are declared.
const PREVIOUS_ID: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_MAP_IDS).map(([oldId, newId]) => [newId, oldId]),
);

// Cloud home for authored maps: the additive, siege-only `siege_maps` table (see the SQL Geoff
// pastes into the Supabase dashboard). types.ts is generated and doesn't include it yet, so these
// calls are loosely typed. Cloud is best-effort + needs auth; local IndexedDB is always written.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloud = supabase as unknown as { from: (t: string) => any };
async function currentUserId(): Promise<string | null> {
  try { const { data } = await supabase.auth.getUser(); return data.user?.id ?? null; } catch { return null; }
}

export interface MapSaveData {
  id: string;
  name?: string;
  savedAt?: number;
  version: number;
  heightField: { baseY: number; samples: number[] };
  water: { on: boolean; level: number };
  objects?: PlacedObject[];   // drop-in builder placements (added v2; absent in v1 saves → [])
}

const DB_NAME = 'siege-maps';
const STORE = 'maps';
const SAVE_VERSION = 2;

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

export async function saveMap(data: Omit<MapSaveData, 'version' | 'savedAt'>): Promise<{ cloud: boolean }> {
  // 1) Local IndexedDB — always, instant, survives reloads on this browser.
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...data, version: SAVE_VERSION, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* persistence is best-effort during dev */ }

  // 2) Supabase — the durable, cross-device copy. Needs a signed-in user (RLS: owner-only writes).
  try {
    const uid = await currentUserId();
    if (!uid) { console.warn('[mapPersistence] cloud save skipped — not signed in'); return { cloud: false }; }
    const { error } = await cloud.from('siege_maps').upsert({
      id: data.id, name: data.name ?? data.id, owner_id: uid,
      data: { heightField: data.heightField, water: data.water, objects: data.objects ?? [] },
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn('[mapPersistence] cloud save failed', error);
    return { cloud: !error };
  } catch (e) { console.warn('[mapPersistence] cloud save threw', e); return { cloud: false }; }
}

export async function loadMap(id: string): Promise<MapSaveData | null> {
  const found = await loadMapById(id);
  if (found) return found;
  // Renamed map: nothing saved under the current id yet, so look for a sculpt saved under the old
  // one. Returned under the CURRENT id, so the next save writes to the new key and migrates itself.
  const prev = PREVIOUS_ID[id];
  if (!prev) return null;
  const legacy = await loadMapById(prev);
  return legacy ? { ...legacy, id } : null;
}

async function loadMapById(id: string): Promise<MapSaveData | null> {
  // Prefer the cloud copy (latest, cross-device); cache it locally; fall back to IndexedDB offline.
  try {
    const { data, error } = await cloud.from('siege_maps').select('name, data').eq('id', id).maybeSingle();
    if (error) console.warn('[mapPersistence] cloud load failed', error);
    if (!error && data?.data?.heightField) {
      const m: MapSaveData = {
        id, name: data.name, version: SAVE_VERSION, savedAt: Date.now(),
        heightField: data.data.heightField,
        water: data.data.water ?? { on: false, level: 4 },
        objects: data.data.objects ?? [],
      };
      try { const d = await db(); const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put({ ...m }); } catch { /* cache best-effort */ }
      return m;
    }
  } catch { /* offline / not signed in → fall through to local */ }
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
