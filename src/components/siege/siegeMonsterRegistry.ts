// siegeMonsterRegistry — the read model behind the Admin → NPC → "Enemies SW" panel. Roster is
// MONSTER_CATALOG (every SWW type). Stats come from effectiveCfg (code defaults + admin overrides),
// so the panel shows the LIVE base values and re-renders whenever an admin saves an edit. Types 6
// (skeleton horde), 9 (Ghost) and 18 (Crawler) render via their own components (no CFG row) — their
// stats fall back to the catalog base and aren't stat-editable (name + tags still are). Tags default
// to an auto-derived set (monsterTags) and can be overridden per monster.
import { useSyncExternalStore } from 'react';
import { CFG, MONSTER_CATALOG, effectiveCfg, type MType } from './siegeMonsterCatalog';
import { getMonsterOverride, subscribeMonsterStats } from './monsterStats';
import { deriveTags } from './monsterTags';
import { COMPONENT_DEFS, effectiveComponentStats, isComponentMonster, type ComponentStatField } from './componentMonsterStats';

export interface SwMonster {
  id: number;
  name: string;
  model: string;
  health: number | null;
  dmgMin: number | null; dmgMax: number | null;
  kbMin: number | null; kbMax: number | null;
  attackRange: number | null; attackMs: number | null;
  speed: number | null;
  aggro: number | null; wanderRadius: number | null;
  sizeJitter: number | null; speedJitter: number | null; animSpeed: number | null; height: number | null;
  gait: string;
  noStun: boolean; noKnockback: boolean; enrageOnHit: boolean;
  tags: string[];
  spawn: string;
  pathfinding: string;
  behavior: string;
  editable: boolean;   // CFG-driven types support the fixed stat grid; component types use `component`
  // Component-driven monsters (horde/ghost/crawler) expose their OWN schema-driven editable stats
  // (saved through the same override system, keyed by npcType). When present, the panel renders these.
  component?: { fields: ComponentStatField[]; values: Record<string, number> };
}

// Models for the special, non-CFG component monsters (each has its own renderer).
const SPECIAL_MODELS: Record<number, string> = {
  6: 'skeletonheavy / light / ranger',
  9: 'skeletonflesh',
  18: 'skeletonflesh_crawl',
};

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
  19: { pathfinding: 'Ground chase; enrages when shot.', behavior: 'Dancing demon (DF model); committed swipe; topple death.' },
};

function modelLabel(url: string): string {
  return url.split('/').pop()?.replace(/\.glb$/, '') ?? url;
}

// SiegeSpawner reads "!" + a TWO-DIGIT type number + a quantity digit (0 = 10). e.g. !07 then 3.
function spawnCmd(id: number): string {
  return `!${String(id).padStart(2, '0')} then 1–9 (0 = 10)`;
}

function compute(): SwMonster[] {
  const list: SwMonster[] = MONSTER_CATALOG.map((cat) => {
    const m = effectiveCfg(cat.id as MType);   // CFG types → merged stats; component types → undefined
    const o = getMonsterOverride(cat.id);
    const mc = m?.meleeContact;
    // Component-driven types (6/9/18): real, admin-tunable stats from componentMonsterStats. Display
    // numbers come from there (honest), and the schema drives the panel's editable grid.
    const comp = isComponentMonster(cat.id)
      ? { fields: COMPONENT_DEFS[cat.id].fields, values: effectiveComponentStats(cat.id) }
      : undefined;
    const cv = comp?.values;
    const height = comp ? (cv!.height ?? cat.baseHeight) : (m?.height ?? cat.baseHeight);
    return {
      id: cat.id,
      name: typeof o.name === 'string' ? o.name : cat.name,
      model: m ? modelLabel(m.url) : (SPECIAL_MODELS[cat.id] ?? '—'),
      health: comp ? (cv!.health ?? null) : (m?.health ?? cat.baseHealth),
      dmgMin: comp ? (cv!.dmgMin ?? null) : (mc?.dmg?.[0] ?? null), dmgMax: comp ? (cv!.dmgMax ?? null) : (mc?.dmg?.[1] ?? null),
      kbMin: mc?.kb?.[0] ?? null, kbMax: mc?.kb?.[1] ?? null,
      attackRange: comp ? (cv!.attackRange ?? null) : (m?.attackRange ?? null), attackMs: comp ? (cv!.attackMs ?? null) : (m?.attackMs ?? null),
      speed: comp ? (cv!.speed ?? null) : (m?.speed ?? null),
      aggro: m ? (m.aggro ?? 400) : null, wanderRadius: m ? (m.wanderRadius ?? 6) : null,
      sizeJitter: comp ? (cv!.sizeJitter ?? null) : (m?.sizeJitter ?? null), speedJitter: comp ? (cv!.speedJitter ?? null) : (m?.speedJitter ?? null),
      animSpeed: m?.animSpeed ?? null, height,
      gait: m?.gait ?? '—',
      noStun: !!m?.noStun, noKnockback: !!m?.noKnockback, enrageOnHit: !!m?.enrageOnHit,
      tags: Array.isArray(o.tags) ? (o.tags as string[]) : deriveTags(m ?? null, cat.id, height),
      spawn: spawnCmd(cat.id),
      pathfinding: AI[cat.id]?.pathfinding ?? '—',
      behavior: AI[cat.id]?.behavior ?? '—',
      editable: !!CFG[cat.id as MType],
      component: comp,
    };
  });
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// Snapshot recomputed whenever an override changes (or the cache loads), so the panel re-renders.
let snapshot: SwMonster[] = compute();
const subs = new Set<() => void>();
subscribeMonsterStats(() => { snapshot = compute(); subs.forEach((f) => f()); });

export function getSwMonsters(): SwMonster[] { return snapshot; }
export function subscribeSwMonsters(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }
export function useSwMonsters(): SwMonster[] {
  return useSyncExternalStore(subscribeSwMonsters, getSwMonsters, getSwMonsters);
}
