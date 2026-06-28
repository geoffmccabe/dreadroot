// componentMonsterStats — admin-editable BASE stats for the COMPONENT-DRIVEN monsters (the ones with
// no CFG entry: the Bloody Skeleton horde (6), the Ghost (9), and the Crawler (18)). These used to be
// hard-coded constants inside their components, so the admin panel showed fiction and couldn't tune
// them. Now each type declares a SCHEMA (the editable fields + labels) and DEFAULTS that reproduce the
// old hard-coded behaviour exactly. Overrides ride the SAME system as CFG monsters (sw_monster_overrides,
// keyed by npcType) — no new storage — and the components read effectiveComponentStats() at spawn.
//
// Modular by design: adding a new tunable = one line in a type's `fields` + `defaults`; the admin panel
// renders it automatically and the override/persist path already handles it. The schema-driven pattern
// is game-agnostic and can be reused for Dreadroot's component-driven enemies later.
//
// NOT here (owned by the senses window): sight/hearing/smell + camo/stealth/scent. And the numerically
// sensitive locomotion internals (raycast stick distances, climb-angle threshold, head deadzone) stay
// as code constants in the component — they're algorithm tuning, not gameplay "settings".
import { getMonsterOverride } from './monsterStats';

export interface ComponentStatField {
  key: string;
  label: string;
  group?: string;   // panel section header (optional)
}

export interface ComponentDef {
  fields: ComponentStatField[];
  defaults: Record<string, number>;
}

// Field order = panel order. Groups let the panel section them.
export const COMPONENT_DEFS: Record<number, ComponentDef> = {
  // Bloody Skeleton horde — each member is randomised between the min/max of each range, so admins
  // tune the SPREAD, keeping the varied-horde feel. (Per-member health is still ×1/2/3 by skeleton
  // variant; speed/height are absolute.) Defaults reproduce the old makeHordeMember() ranges exactly.
  6: {
    fields: [
      { key: 'healthMin', label: 'Health min', group: 'Ranges' },
      { key: 'healthMax', label: 'Health max', group: 'Ranges' },
      { key: 'speedMin', label: 'Speed min (m/s)', group: 'Ranges' },
      { key: 'speedMax', label: 'Speed max (m/s)', group: 'Ranges' },
      { key: 'heightMin', label: 'Height min (m)', group: 'Ranges' },
      { key: 'heightMax', label: 'Height max (m)', group: 'Ranges' },
    ],
    defaults: { healthMin: 10, healthMax: 100, speedMin: 1.25, speedMax: 3.75, heightMin: 0.5, heightMax: 3 },
  },

  // Ghost — flying upside-down diver. "Everything incl. exotic" exposes the meaningful knobs; the
  // orbit micro-feel (bob/radius wobble) stays in code.
  9: {
    fields: [
      { key: 'health', label: 'Health', group: 'Stats' },
      { key: 'height', label: 'Height (m)', group: 'Stats' },
      { key: 'sizeJitter', label: 'Size jitter (±)', group: 'Stats' },
      { key: 'speedJitter', label: 'Speed jitter (±)', group: 'Stats' },
      { key: 'opacity', label: 'Opacity (=dmg taken)', group: 'Exotic' },
      { key: 'diveSpeed', label: 'Dive speed (m/s)', group: 'Exotic' },
      { key: 'hitR', label: 'Hit radius (m)', group: 'Exotic' },
      { key: 'strikeJitter', label: 'Strike jitter (m)', group: 'Exotic' },
      { key: 'dmgMin', label: 'Dmg min', group: 'Combat' },
      { key: 'dmgMax', label: 'Dmg max', group: 'Combat' },
    ],
    defaults: { health: 100, height: 4, sizeJitter: 0.15, speedJitter: 0.15, opacity: 0.2, diveSpeed: 10.8, hitR: 1.4, strikeJitter: 0.25, dmgMin: 1, dmgMax: 50 },
  },

  // Crawler — surface-walking biter. Exposes gameplay + movement-feel; the raycast geometry internals
  // (stick up/down distances, climb-dot, head deadzone) stay in code as algorithm constants.
  18: {
    fields: [
      { key: 'health', label: 'Health', group: 'Stats' },
      { key: 'height', label: 'Height (m)', group: 'Stats' },
      { key: 'speed', label: 'Speed (m/s)', group: 'Stats' },
      { key: 'sizeJitter', label: 'Size jitter (±)', group: 'Stats' },
      { key: 'speedJitter', label: 'Speed jitter (±)', group: 'Stats' },
      { key: 'attackRange', label: 'Atk range (m)', group: 'Combat' },
      { key: 'attackMs', label: 'Atk every (ms)', group: 'Combat' },
      { key: 'dmgMin', label: 'Dmg min', group: 'Combat' },
      { key: 'dmgMax', label: 'Dmg max', group: 'Combat' },
      { key: 'hover', label: 'Ride height (m)', group: 'Movement' },
      { key: 'bodyR', label: 'Body radius (m)', group: 'Movement' },
      { key: 'gravity', label: 'Fall gravity', group: 'Movement' },
      { key: 'turnRate', label: 'Turn rate (rad/s)', group: 'Movement' },
    ],
    defaults: { health: 40, height: 1.4, speed: 3.4, sizeJitter: 0.15, speedJitter: 0.25, attackRange: 1.3, attackMs: 1100, dmgMin: 10, dmgMax: 25, hover: 0.06, bodyR: 0.28, gravity: 22, turnRate: 4.0 },
  },
};

export const isComponentMonster = (type: number): boolean => type in COMPONENT_DEFS;

/** Effective stats for a component monster: defaults with the admin's numeric overrides merged on top.
 *  Returns a fresh object (read once per spawn into a ref so the instance is stable). */
export function effectiveComponentStats(type: number): Record<string, number> {
  const def = COMPONENT_DEFS[type];
  if (!def) return {};
  const o = getMonsterOverride(type);
  const out: Record<string, number> = { ...def.defaults };
  for (const f of def.fields) {
    const v = o[f.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[f.key] = v;
  }
  return out;
}
