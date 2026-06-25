// monsterTags — a CURATED, searchable tag vocabulary for Siege Worlds monsters. These are the
// dimensions an admin / challenge-creator actually filters by ("give me all ranged bosses", "all
// flying", "all stun-immune"), grouped so the editor can show them by category. Defaults are
// auto-derived from each monster's stats; admins can override the set per monster.

export const TAG_GROUPS: { group: string; tags: string[] }[] = [
  { group: 'Role',      tags: ['boss', 'elite', 'horde', 'minion'] },
  { group: 'Range',     tags: ['melee', 'ranged'] },
  { group: 'Movement',  tags: ['flying', 'wall-crawler', 'fast', 'slow', 'giant'] },
  { group: 'Behavior',  tags: ['teleporter', 'spinner', 'enrager', 'kiter'] },
  { group: 'Damage',    tags: ['physical', 'acid', 'lightning', 'fire'] },
  { group: 'Defense',   tags: ['stun-immune', 'kb-immune'] },
];

export const ALL_TAGS: string[] = TAG_GROUPS.flatMap((g) => g.tags);

// What deriveTags reads — the relevant slice of a (merged) CFG entry. Loosely typed so it works
// for both real CFG rows and the component monsters' base stats.
export interface TagSource {
  boss?: string;
  spray?: unknown;
  rangedRange?: number;
  lightning?: boolean;
  bodyFlames?: unknown;
  spin?: unknown;
  enrageOnHit?: boolean;
  noStun?: boolean;
  noKnockback?: boolean;
  speed?: number | null;
}

// Auto-derive a sensible default tag set from a monster's stats. id/height let us tag the
// component-driven monsters (6 horde, 9 ghost, 18 crawler) and the giants.
export function deriveTags(m: TagSource | null, id: number, height: number): string[] {
  const t = new Set<string>();
  const ranged = !!(m?.spray || m?.rangedRange);

  // Role
  if (m?.boss) t.add('boss');
  if (id === 6) t.add('horde');

  // Range + Damage
  if (ranged) t.add('ranged'); else t.add('melee');
  if (m?.spray) t.add('acid');
  if (m?.lightning) t.add('lightning');
  if (m?.bodyFlames) t.add('fire');
  if (!m?.spray && !m?.lightning && !m?.bodyFlames) t.add('physical');

  // Movement
  if (id === 9) t.add('flying');
  if (id === 18) t.add('wall-crawler');
  if (height >= 6) t.add('giant');
  const spd = m?.speed ?? 0;
  if (spd >= 4) t.add('fast');
  else if (spd > 0 && spd <= 2.6) t.add('slow');

  // Behavior
  if (m?.boss === 'teleporter') t.add('teleporter');
  if (m?.spin) t.add('spinner');
  if (m?.enrageOnHit) t.add('enrager');
  if (ranged) t.add('kiter');

  // Crowd-control immunity
  if (m?.noStun) t.add('stun-immune');
  if (m?.noKnockback) t.add('kb-immune');

  return [...t];
}
