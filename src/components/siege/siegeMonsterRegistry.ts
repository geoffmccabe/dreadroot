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
  pathfinding: string;        // how it moves / navigates (read-only — native AI)
  behavior: string;           // notable AI behaviors (read-only — native AI)
}

// Native AI / pathfinding per monster (read-only — these behaviors live in each monster's
// renderer/AI, not in editable stats; listed so admins understand how each one acts).
const AI: Record<number, { pathfinding: string; behavior: string }> = {
  1:  { pathfinding: 'Ground chase; A* when stuck; climbs over other demons.', behavior: 'Melee swipe; lunges on the swing.' },
  2:  { pathfinding: 'Ground chase; hops/jumps over walls (hop gait).', behavior: '360° spin-lunge; bullets tumble it; deflates on death.' },
  3:  { pathfinding: 'Ground A* chase; climbs large obstacles.', behavior: 'Big skeleton; animation speed scales with size.' },
  4:  { pathfinding: 'Kites — keeps ~20–30 m away (ranged).', behavior: 'Acid-vomit spray cone; grunts annoyed after misses.' },
  5:  { pathfinding: 'Teleporter boss — blinks behind the player.', behavior: 'Lightning beam; purple body flames; opacity = damage resist; no stun.' },
  6:  { pathfinding: 'Tight ~5 m horde cluster; pursues when player is near (own component).', behavior: 'Every mob randomized (size/speed/HP/tint); zombie moans.' },
  7:  { pathfinding: 'Chases while spinning.', behavior: 'Erratic zoom-dashes (contact dmg ×2); spins your view; smoke trail; flames; no stun/knockback.' },
  8:  { pathfinding: 'Ground A* chase (climb gait).', behavior: 'Big (4 m), 1000 HP, no stun.' },
  9:  { pathfinding: 'Flying — orbits 4–9 m and dives (own component).', behavior: 'Upside-down, 20% opacity (resistant); dive strikes; no stun/knockback; tumbles on death.' },
  10: { pathfinding: 'Ground chase; enrages when shot (walk→run +50%).', behavior: 'Committed swipe; topple death.' },
  11: { pathfinding: 'Ground chase; enrages when shot.', behavior: 'Committed swipe; topple death.' },
  12: { pathfinding: 'Ground chase; enrages when shot.', behavior: 'Committed swipe; topple death.' },
  13: { pathfinding: 'Ground chase; enrages when shot.', behavior: 'Committed swipe; topple death.' },
  14: { pathfinding: 'Ground chase; enrages when shot.', behavior: 'Giant (6 m); committed swipe; topple death.' },
  15: { pathfinding: 'Ground chase; enrages when shot.', behavior: 'Giant (8 m); committed swipe; topple death.' },
  16: { pathfinding: 'Ground chase; enrages when shot.', behavior: 'Giant (10 m); committed swipe; topple death.' },
  17: { pathfinding: 'Ground chase; enrages when shot.', behavior: 'Giant (12 m); committed swipe; topple death.' },
  18: { pathfinding: 'Wall-crawler — walks floors, walls + ceilings; climbs over enemies (own component).', behavior: 'Bite attack; scuttles along surfaces.' },
  19: { pathfinding: 'None — decorative.', behavior: 'Loops a dance clip in the Death Dark City challenge.' },
};

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
        ? [
            m.boss ? `boss:${m.boss}` : '',
            m.spray ? 'ranged' : '',
            m.spin ? 'spin' : '',
            m.attackStyle ?? '',
            m.enrageOnHit ? 'enrages' : '',
            m.lightning ? 'lightning' : '',
            m.bodyFlames ? 'flames' : '',
            m.smokeTrail ? 'smoke' : '',
            m.noStun ? 'no-stun' : '',
            m.noKnockback ? 'no-kb' : '',
          ].filter(Boolean).join(' ')
        : (SPECIAL_TAGS[cat.id] ?? ''),
      spawn: spawnCmd(cat.id),
      pathfinding: AI[cat.id]?.pathfinding ?? '—',
      behavior: AI[cat.id]?.behavior ?? '—',
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
    pathfinding: AI[19].pathfinding, behavior: AI[19].behavior,
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
