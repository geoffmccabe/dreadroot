// siegeMonsterRegistry — the read model behind the Admin → NPC → "Enemies SW" panel.
// Siege Worlds monsters are a SEPARATE system from the EMS/Dreadroot enemies, but they
// share core stats (health, damage, range…). Those stats live in the gameplay catalog
// (siegeMonsterCatalog.CFG, keyed by npcType); this module pairs each with an editable
// DISPLAY NAME and exposes the roster sorted alphabetically by name. Stats are read
// straight from CFG (single source of truth — no duplication); only the name is stored
// here (per-device localStorage for now — the seed for the future unified registry).
import { useSyncExternalStore } from 'react';
import { CFG } from './siegeMonsterCatalog';

export interface SwMonster {
  id: number;                 // npcType
  name: string;               // display name (override or default)
  model: string;              // glb basename
  health: number;
  dmgMin: number | null;
  dmgMax: number | null;
  attackRange: number | null; // metres
  attackMs: number | null;    // ms between attacks
  speed: number;              // m/s
  gait: string;
  special: string;            // boss / ranged / spin / attack-style tags
}

// Default names per npcType. Editable in the panel; overrides win.
const DEFAULT_NAMES: Record<number, string> = {
  1: 'Demon Horde',
  2: 'Mushroom Grunt',
  3: 'Giant Skeleton',
  4: 'Acid Demon',
  5: 'Dark Lord',
  6: 'Bloody Skeleton',
  7: 'Green Troll',
  8: 'Red Demon',
};

const KEY = 'dr_sw_monster_names';

function loadOverrides(): Record<number, string> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

let overrides = loadOverrides();

function modelLabel(url: string): string {
  return url.split('/').pop()?.replace(/\.glb$/, '') ?? url;
}

function compute(): SwMonster[] {
  const list: SwMonster[] = [];
  for (const k of Object.keys(CFG)) {
    const id = Number(k);
    const m = (CFG as Record<number, NonNullable<(typeof CFG)[keyof typeof CFG]>>)[id];
    if (!m) continue;
    list.push({
      id,
      name: overrides[id] ?? DEFAULT_NAMES[id] ?? `Monster ${id}`,
      model: modelLabel(m.url),
      health: m.health,
      dmgMin: m.meleeContact?.dmg?.[0] ?? null,
      dmgMax: m.meleeContact?.dmg?.[1] ?? null,
      attackRange: m.attackRange ?? null,
      attackMs: m.attackMs ?? null,
      speed: m.speed,
      gait: m.gait,
      special: [
        m.boss ? `boss:${m.boss}` : '',
        m.spray ? 'ranged' : '',
        m.spin ? 'spin' : '',
        m.attackStyle ?? '',
      ].filter(Boolean).join(' '),
    });
  }
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
