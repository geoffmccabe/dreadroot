// Save/load authored lights to the shared effect_definitions table (family 'lights')
// and keep an in-memory registry keyed by the reusable CODE — so any part of the game
// can do getLight('shombie-face') and attach it. Loosely typed + graceful like effectsDb.
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_LIGHT, type LightDef } from './lightTypes';

const registry = new Map<string, LightDef>();

export function registerLight(def: LightDef): void { registry.set(def.code, def); }
export function getLight(code: string): LightDef | null { return registry.get(code) ?? null; }
export function allLights(): LightDef[] { return [...registry.values()]; }

function defToParams(d: LightDef): Record<string, unknown> {
  // Everything except the identity fields lives in the params JSON.
  const { code, name, type, ...rest } = d;
  void code; void name; void type;
  return rest as Record<string, unknown>;
}

function rowToDef(row: any): LightDef {
  const p = row.params ?? {};
  return { ...DEFAULT_LIGHT, ...p, code: row.code, name: row.name, type: 'spotlight' };
}

export async function saveLight(def: LightDef): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;
  const row = {
    code: def.code,
    name: def.name,
    family: 'lights',
    backend: 'lights',
    blend: 'alpha',
    params: defToParams(def),
    gameplay: null,
    game_id: null,
    owner_id: uid,
    is_builtin: false,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  const { error } = await (supabase as any).from('effect_definitions').upsert([row], { onConflict: 'code' });
  if (error) throw error;
  registerLight(def);
}

export async function loadLights(): Promise<LightDef[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('effect_definitions')
      .select('*')
      .eq('family', 'lights')
      .eq('is_active', true);
    if (error || !data) return [];
    const defs = (data as any[]).map(rowToDef);
    for (const d of defs) registerLight(d);
    return defs;
  } catch {
    return [];
  }
}

export async function deleteLight(code: string): Promise<void> {
  try {
    await (supabase as any).from('effect_definitions').delete().eq('code', code).eq('family', 'lights');
  } catch { /* ignore */ }
  registry.delete(code);
}
