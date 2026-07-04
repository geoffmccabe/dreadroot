// pgPersistence — save/load a PG "object set" (the whole PgParams: chosen species + weights + sizes +
// altitudes + scatter settings). Small config (a few KB), so plain JSON. Stored per-map in Supabase
// (siege_pg_sets, owner-scoped RLS — see the SQL) with local IndexedDB fallback, plus file export/import.
import { supabase } from '@/integrations/supabase/client';
import { getPgParams, setPgParams, type PgParams } from './pgState';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloud = supabase as unknown as { from: (t: string) => any };
async function uid(): Promise<string | null> {
  try { const { data } = await supabase.auth.getUser(); return data.user?.id ?? null; } catch { return null; }
}

export async function savePgSet(mapId: string, name: string): Promise<{ cloud: boolean }> {
  const data = getPgParams();
  try { localStorage.setItem(`pgset_${mapId}`, JSON.stringify(data)); } catch { /* best effort */ }
  try {
    const owner = await uid();
    if (!owner) { console.warn('[pgSet] cloud save skipped — not signed in'); return { cloud: false }; }
    const { error } = await cloud.from('siege_pg_sets').upsert({ id: mapId, name, owner_id: owner, data, updated_at: new Date().toISOString() });
    if (error) console.warn('[pgSet] cloud save failed', error);
    return { cloud: !error };
  } catch (e) { console.warn('[pgSet] cloud save threw', e); return { cloud: false }; }
}

export async function loadPgSet(mapId: string): Promise<boolean> {
  try {
    const { data, error } = await cloud.from('siege_pg_sets').select('data').eq('id', mapId).maybeSingle();
    if (!error && data?.data?.chosen) { setPgParams(data.data as PgParams); return true; }
  } catch { /* offline → local */ }
  try {
    const raw = localStorage.getItem(`pgset_${mapId}`);
    if (raw) { const d = JSON.parse(raw); if (d?.chosen) { setPgParams(d as PgParams); return true; } }
  } catch { /* ignore */ }
  return false;
}

// Download the set as a compressed .json.gz (same gzip path as the world backup).
export async function exportPgSet(name: string): Promise<void> {
  const json = JSON.stringify(getPgParams());
  const gz = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(gz).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (name || 'pgset').replace(/[^a-z0-9_-]+/gi, '_');
  a.href = url; a.download = `${safe}-${new Date().toISOString().slice(0, 10)}.json.gz`;
  a.click(); URL.revokeObjectURL(url);
}

// Load a set file — accepts the new compressed .json.gz OR a plain .json.
export async function importPgSet(file: File): Promise<boolean> {
  try {
    const text = file.name.endsWith('.gz')
      ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : await file.text();
    const d = JSON.parse(text);
    if (d?.chosen) { setPgParams(d as PgParams); return true; }
  } catch { /* ignore */ }
  return false;
}

// ── Named, shareable set library (siege_pg_library) ─────────────────────────────
// Each SAVE creates a named set owned by you; mark it public so other players can browse + generate
// with it. Resilient: if the table/columns aren't in the cloud yet, saving still works locally.
export interface PgSetRow { id: string; name: string; owner_id: string; is_public: boolean; game: string; data: PgParams; updated_at?: string }

export async function saveNamedSet(name: string, isPublic: boolean, game: string): Promise<{ cloud: boolean }> {
  const data = getPgParams();
  try { localStorage.setItem('pglib_last', JSON.stringify({ name, isPublic, data })); } catch { /* best effort */ }
  const owner = await uid();
  if (!owner) { console.warn('[pgLib] save skipped — not signed in'); return { cloud: false }; }
  try {
    const { error } = await cloud.from('siege_pg_library').insert({ owner_id: owner, game, name, is_public: isPublic, data });
    if (error) console.warn('[pgLib] cloud save failed', error);
    return { cloud: !error };
  } catch (e) { console.warn('[pgLib] cloud save threw', e); return { cloud: false }; }
}

export async function listMySets(game: string): Promise<PgSetRow[]> {
  const owner = await uid(); if (!owner) return [];
  try {
    const { data } = await cloud.from('siege_pg_library').select('*').eq('game', game).eq('owner_id', owner).order('updated_at', { ascending: false });
    return (data as PgSetRow[]) ?? [];
  } catch { return []; }
}

export async function listPublicSets(game: string): Promise<PgSetRow[]> {
  try {
    const { data } = await cloud.from('siege_pg_library').select('*').eq('game', game).eq('is_public', true).order('updated_at', { ascending: false }).limit(100);
    return (data as PgSetRow[]) ?? [];
  } catch { return []; }
}

// Load a library row's settings into the live generator.
export function applyPgSet(row: PgSetRow): boolean {
  if (row?.data?.chosen) { setPgParams(row.data); return true; }
  return false;
}
