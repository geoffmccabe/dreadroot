// monsterStats — admin-editable BASE-stat overrides for Siege Worlds monsters.
//
// Source of truth: the `sw_monster_overrides` Supabase table (one JSONB row per npcType,
// holding only the fields an admin changed). Players cache it to IndexedDB so challenges
// load fast and work offline; an in-memory map is the synchronous read used at spawn time.
//
// Flow: loadMonsterStatsCache() (IndexedDB → memory) on first use → syncMonsterStats() at
// world init (Supabase → memory + IndexedDB, reports how many changed since last login) →
// saveMonsterOverride() when an admin edits (Supabase + memory + IndexedDB). The catalog's
// effectiveCfg() merges these over the code defaults; CatalogMonster reads it fresh each spawn.
import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type MonsterOverride = Record<string, unknown>; // partial of the editable CFG fields

const DB_NAME = 'sw_monster_stats';
const STORE = 'overrides';
const TABLE = 'sw_monster_overrides';

interface Row { npc_type: number; data: MonsterOverride; updated_at: string }

let mem: Record<number, Row> = {};
let version = 0;                 // bumps on any change → stable snapshot for useSyncExternalStore
const subs = new Set<() => void>();
const notify = () => { version++; subs.forEach((f) => f()); };

// ── tiny IndexedDB key-value (keyed by npc_type) ──────────────────────────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'npc_type' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetAll(): Promise<Row[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as Row[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}
async function idbPut(rows: Row[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      for (const r of rows) s.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}
async function idbDelete(types: number[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      for (const t of types) s.delete(t);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

// ── public read API ───────────────────────────────────────────────────────────
export function getMonsterOverride(npcType: number): MonsterOverride {
  return mem[npcType]?.data ?? {};
}

let loaded: Promise<void> | null = null;
/** Load the IndexedDB cache into memory once (sync reads use the in-memory map afterward). */
export function loadMonsterStatsCache(): Promise<void> {
  if (!loaded) {
    loaded = idbGetAll().then((rows) => {
      for (const r of rows) mem[r.npc_type] = r;
      notify();
    });
  }
  return loaded;
}

/** World-init sync: pull overrides from Supabase, update memory + IndexedDB, and report how many
 *  changed since this device last cached them (for the "models updated since last login" log). */
export async function syncMonsterStats(): Promise<{ updated: number; total: number }> {
  await loadMonsterStatsCache();
  const { data, error } = await supabase.from(TABLE as never).select('npc_type, data, updated_at');
  if (error || !data) return { updated: 0, total: Object.keys(mem).length };

  let updated = 0;
  const persist: Row[] = [];
  const serverTypes = new Set<number>();
  for (const r of data as unknown as Row[]) {
    serverTypes.add(r.npc_type);
    const cached = mem[r.npc_type];
    if (!cached || cached.updated_at !== r.updated_at) {
      updated++;
      mem[r.npc_type] = { npc_type: r.npc_type, data: r.data ?? {}, updated_at: r.updated_at };
      persist.push(mem[r.npc_type]);
    }
  }
  // Overrides the admin reset to default (row deleted) → drop from our cache too.
  const gone = Object.keys(mem).map(Number).filter((t) => !serverTypes.has(t));
  for (const t of gone) { delete mem[t]; updated++; }
  if (persist.length) await idbPut(persist);
  if (gone.length) await idbDelete(gone);
  if (updated) notify();
  return { updated, total: serverTypes.size };
}

/** Admin: merge a partial patch into an npcType's override and persist it everywhere. Pass a
 *  field as null to clear it (revert to the code default). */
export async function saveMonsterOverride(npcType: number, patch: MonsterOverride): Promise<boolean> {
  const merged: MonsterOverride = { ...(mem[npcType]?.data ?? {}), ...patch };
  for (const k of Object.keys(merged)) if (merged[k] == null) delete merged[k];

  const { data, error } = await supabase.from(TABLE as never)
    .upsert({ npc_type: npcType, data: merged } as never, { onConflict: 'npc_type' })
    .select('updated_at').single();
  if (error) { console.error('[monsterStats] save failed:', error); return false; }

  const updated_at = (data as { updated_at?: string } | null)?.updated_at ?? new Date().toISOString();
  mem[npcType] = { npc_type: npcType, data: merged, updated_at };
  await idbPut([mem[npcType]]);
  notify();
  return true;
}

/** Admin: clear an npcType's override entirely (revert to the code defaults). */
export async function clearMonsterOverride(npcType: number): Promise<boolean> {
  const { error } = await supabase.from(TABLE as never).delete().eq('npc_type', npcType);
  if (error) { console.error('[monsterStats] clear failed:', error); return false; }
  delete mem[npcType];
  await idbDelete([npcType]);
  notify();
  return true;
}

// ── React binding ───────────────────────────────────────────────────────────
export function subscribeMonsterStats(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }
export function getMonsterStatsVersion(): number { return version; }
/** Re-renders whenever any override changes (panel + registry read effectiveCfg off this). */
export function useMonsterStatsVersion(): number {
  return useSyncExternalStore(subscribeMonsterStats, getMonsterStatsVersion, getMonsterStatsVersion);
}
