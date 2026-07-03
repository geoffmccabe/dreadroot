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

export function exportPgSet(mapId: string): void {
  const blob = new Blob([JSON.stringify(getPgParams(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${mapId}-pgset-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

export function importPgSet(file: File): Promise<boolean> {
  return file.text().then((t) => {
    try { const d = JSON.parse(t); if (d?.chosen) { setPgParams(d as PgParams); return true; } } catch { /* ignore */ }
    return false;
  });
}
