// DB bridge for effect recipes. The `effect_definitions` table may not exist in
// the generated Supabase types yet (it's applied via the dashboard, then types
// regenerated), so access is intentionally loose-typed here and isolated to this
// file. Everything degrades gracefully: if the table is missing, load returns 0
// and the hardcoded fallback recipes keep the engine running.

import { supabase } from '@/integrations/supabase/client';
import type { EffectRecipe } from './types';
import { registerRecipe, isBuiltinCode } from './recipes';

/** EffectRecipe → the `params` JSONB blob stored on the row. */
export function recipeToParams(r: EffectRecipe): Record<string, unknown> {
  return {
    lifetime: r.lifetime, spawnRate: r.spawnRate, spread: r.spread,
    rise: r.rise, gravity: r.gravity, wind: r.wind,
    flutterAmp: r.flutterAmp, flutterFreq: r.flutterFreq, spin: r.spin,
    size0: r.size0, size1: r.size1, opacity0: r.opacity0, opacity1: r.opacity1,
    color0: r.color0, color1: r.color1, disperseGrow: r.disperseGrow,
    cullDistance: r.cullDistance, fadeStart: r.fadeStart, fadeEnd: r.fadeEnd,
    importance: r.importance, maxInstances: r.maxInstances,
    spiral: r.spiral, spiralRate: r.spiralRate,
    spiralSize0: r.spiralSize0, spiralSize1: r.spiralSize1,
    spiralOpacity: r.spiralOpacity, spiralLighten: r.spiralLighten,
    spiralTurns: r.spiralTurns,
    spiralSpinMinSec: r.spiralSpinMinSec, spiralSpinMaxSec: r.spiralSpinMaxSec,
  };
}

/** A DB row → EffectRecipe, with defaults so partial rows never break. */
function rowToRecipe(row: any): EffectRecipe {
  const p = row.params ?? {};
  const wind = Array.isArray(p.wind) ? [Number(p.wind[0]) || 0, Number(p.wind[1]) || 0] : [0, 0];
  return {
    code: row.code,
    family: row.family ?? 'smoke',
    backend: 'billboard',
    blend: row.blend === 'additive' ? 'additive' : 'alpha',
    lifetime: p.lifetime ?? 3,
    spawnRate: p.spawnRate ?? 60,
    spread: p.spread ?? 0.14,
    rise: p.rise ?? 1,
    gravity: p.gravity ?? 0,
    wind: wind as [number, number],
    flutterAmp: p.flutterAmp ?? 0.3,
    flutterFreq: p.flutterFreq ?? 1.1,
    spin: p.spin ?? 0.5,
    size0: p.size0 ?? 0.12,
    size1: p.size1 ?? 0.6,
    opacity0: p.opacity0 ?? 0.32,
    opacity1: p.opacity1 ?? 0,
    color0: p.color0 ?? '#5e5e5e',
    color1: p.color1 ?? '#9a9a9a',
    disperseGrow: p.disperseGrow ?? 0.5,
    cullDistance: p.cullDistance ?? 100,
    fadeStart: p.fadeStart ?? 80,
    fadeEnd: p.fadeEnd ?? 100,
    importance: p.importance ?? 0.25,
    maxInstances: p.maxInstances,
    spiral: p.spiral ?? false,
    spiralRate: p.spiralRate ?? 8,
    spiralSize0: p.spiralSize0 ?? 0.4,
    spiralSize1: p.spiralSize1 ?? 1.1,
    spiralOpacity: p.spiralOpacity ?? 0.5,
    spiralLighten: p.spiralLighten ?? 0.22,
    spiralTurns: p.spiralTurns ?? 2,
    spiralSpinMinSec: p.spiralSpinMinSec ?? 0.5,
    spiralSpinMaxSec: p.spiralSpinMaxSec ?? 1.0,
  };
}

/** Load all active effect recipes from the DB into the in-memory registry.
 *  Returns the number loaded (0 if the table is absent / on any error). */
export async function loadEffectRecipesFromDB(): Promise<EffectRecipe[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('effect_definitions')
      .select('*')
      .eq('is_active', true);
    if (error) {
      console.warn('[effects] DB load skipped:', error.message);
      return [];
    }
    const recipes: EffectRecipe[] = [];
    for (const row of data ?? []) {
      const r = rowToRecipe(row);
      // Built-in codes are owned by code (source of truth) — never let a stale
      // seeded DB row shadow them. DB only supplies creator variants.
      if (isBuiltinCode(r.code)) continue;
      registerRecipe(r);
      recipes.push(r);
    }
    return recipes;
  } catch (e) {
    console.warn('[effects] DB load failed:', e);
    return [];
  }
}

export interface SaveEffectInput {
  recipe: EffectRecipe;
  name: string;
}

/** Upsert a creator-owned effect variant. Owner = current user (RLS-scoped).
 *  Built-in rows (owner_id null) can't be overwritten — pick a new code. */
export async function saveEffectRecipe({ recipe, name }: SaveEffectInput): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;
  const row = {
    code: recipe.code,
    name,
    family: recipe.family,
    backend: 'billboard',
    blend: recipe.blend,
    params: recipeToParams(recipe),
    gameplay: null,
    game_id: null, // shared across games for now (per-game scoping is a later task)
    owner_id: uid,
    is_builtin: false,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  const { error } = await (supabase as any)
    .from('effect_definitions')
    .upsert([row], { onConflict: 'code' });
  if (error) throw error;
  registerRecipe(recipe);
}
