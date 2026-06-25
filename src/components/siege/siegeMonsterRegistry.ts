// siegeMonsterRegistry — the read model behind the Admin → NPC → "Enemies SW" panel.
// Siege Worlds monsters are a SEPARATE system from the EMS/Dreadroot enemies. The roster is
// MONSTER_CATALOG (every spawnable SWW type, ids 1-18); detailed combat stats live in the
// gameplay catalog (siegeMonsterCatalog.CFG, keyed by npcType). Types 6 (skeleton horde),
// 9 (Ghost) and 18 (Crawler) render via their own components, so they have no CFG row — we
// fall back to the catalog's base stats for those. The Pole Dancer (decor) is appended last.
// Each card also shows HOW TO SPAWN it (the SiegeSpawner sequence). Names are editable here
// (per-device localStorage) and the list auto-sorts alphabetically.
import { useSyncExternalStore } from 'react';
import { CFG, MONSTER_CATALOG, type MType } from './siegeMonsterCatalog';

export interface SwMonster {
  id: number;                 // npcType (19 = the decor Pole Dancer, not a real spawn type)
  name: string;               // display name (override or default)
  model: string;              // glb basename
  health: number;
  dmgMin: number | null;
  dmgMax: number | null;
  attackRange: number | null; // metres
  attackMs: number | null;    // ms between attacks
  speed: number | null;       // m/s
  gait: string;
  special: string;            // boss / ranged / spin / attack-style / kind tags
  spawn: string;              // how to spawn it (admin)
}

// Models + tags for the special, non-CFG catalog types (each has its own renderer).
const SPECIAL_MODELS: Record<number, string> = {
  6: 'skeletonheavy / light / ranger',
  9: 'skeletonflesh',
  18: 'skeletonflesh_crawl',
};
const SPECIAL_TAGS: Record<number, string> = {
  6: 'horde · randomized',
  9: 'flying ghost',
  18: 'wall-crawler',
};

const KEY = 'dr_sw_monster_names';

function loadOverrides(): Record<number, string> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

let overrides = loadOverrides();

function modelLabel(url: string): string {
  return url.split('/').pop()?.replace(/\.glb$/, '') ?? url;
}

// SiegeSpawner reads "!" + a TWO-DIGIT type number + a quantity digit (0 = 10). e.g. !07 then 3.
function spawnCmd(id: number): string {
  return `!${String(id).padStart(2, '0')} then 1–9 (0 = 10)`;
}

function compute(): SwMonster[] {
  const list: SwMonster[] = MONSTER_CATALOG.map((cat) => {
    const m = CFG[cat.id as MType];
    return {
      id: cat.id,
      name: overrides[cat.id] ?? cat.name,
      model: m ? modelLabel(m.url) : (SPECIAL_MODELS[cat.id] ?? '—'),
      health: m?.health ?? cat.baseHealth,
      dmgMin: m?.meleeContact?.dmg?.[0] ?? null,
      dmgMax: m?.meleeContact?.dmg?.[1] ?? null,
      attackRange: m?.attackRange ?? null,
      attackMs: m?.attackMs ?? null,
      speed: m?.speed ?? null,
      gait: m?.gait ?? '—',
      special: m
        ? [m.boss ? `boss:${m.boss}` : '', m.spray ? 'ranged' : '', m.spin ? 'spin' : '', m.attackStyle ?? '', m.enrageOnHit ? 'enrages' : '']
            .filter(Boolean).join(' ')
        : (SPECIAL_TAGS[cat.id] ?? ''),
      spawn: spawnCmd(cat.id),
    };
  });

  // Pole Dancer — decorative dancing demon (dfdemon_dance), no AI/combat. Auto-placed in the
  // "Death Dark City" SciFi-City challenge instance, so there's no spawn command.
  list.push({
    id: 19,
    name: overrides[19] ?? 'Pole Dancer',
    model: 'dfdemon_dance',
    health: 0, dmgMin: null, dmgMax: null, attackRange: null, attackMs: null,
    speed: null, gait: 'dance', special: 'decor',
    spawn: 'Auto — appears in the "Death Dark City" challenge (decor, not spawnable)',
  });

  // Auto-sort alphabetically by name — re-sorts whenever a name changes.
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// Cached snapshot so useSyncExternalStore gets a stable reference between changes.
let snapshot: SwMonster[] = compute();
const subs = new Set<() => void>();

export function getSwMonsters(): SwMonster[] { return snapshot; }

export function setSwMonsterName(id: number, name: string): void {
  overrides = { ...overrides, [id]: name };
  try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch { /* ignore */ }
  snapshot = compute();
  subs.forEach((f) => f());
}

export function subscribeSwMonsters(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }

export function useSwMonsters(): SwMonster[] {
  return useSyncExternalStore(subscribeSwMonsters, getSwMonsters, getSwMonsters);
}
