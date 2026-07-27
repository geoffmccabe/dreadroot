// kaijuStats — the buildable-Kaiju stat system: five stats, a points budget, and abilities.
//
// WHERE THIS COMES FROM. Two video-game systems, not a tabletop one.
//
// STRUCTURE comes from Pokemon, which is the most battle-tested creature stat system that exists:
// roughly a thousand species over thirty years with a competitive scene that has picked the maths
// apart in public. The three pieces worth copying exactly:
//   - a BASE STAT TOTAL that is the species' power budget, so tiers are just larger totals;
//   - a PER-STAT CAP, so you cannot pour the whole budget into one number;
//   - ONE OR TWO ABILITIES per creature, drawn from a pool, which is where the character lives.
// Pokemon also teaches the warning: base stat total is a rough guide, not balance. WHERE the
// points sit matters more than how many there are, and there are high-total species that are bad
// because the points are in the wrong places. So the total is the budget, never the answer.
//
// COMBAT MATHS comes from real-time strategy balance, which reduces a unit to two things: how much
// damage it deals, and how much it absorbs before dying. Combat value is the PRODUCT of the two,
// because damage only counts for as long as you are alive to deal it — a glass cannon that dies
// instantly contributed nothing. This is Lanchester's attrition maths, and it has been the working
// basis of RTS unit costing for decades.
//
// The armour curve is the MOBA one: reduction = armour / (armour + 100). It never reaches 100%, it
// has natural diminishing returns, and it has the pleasant property that effective health works
// out to exactly health x (1 + armour/100) — so armour and health are interchangeable currencies
// and neither one runs away.
//
// WHAT THE MATHS CANNOT PRICE. Instinct (how well the AI plays) has no closed form. It is priced
// by measurement instead: run identical Kaiju that differ only in Instinct and see who wins. That
// is what scripts/check-kaiju-balance.ts is for.

import type { WeaponId } from './kaijuWeapons';
import { WEAPONS } from './kaijuWeapons';

// --- the five stats ------------------------------------------------------------------------------
//
// Five, because Geoff asked for about five and because every one of these has to be something the
// combat simulation already reads. A stat the fight cannot see is decoration.

export interface KaijuStats {
  /** Damage dealt. Multiplies every weapon and the melee swing. */
  might: number;
  /** Damage reduction. Diminishing, never total. */
  armour: number;
  /** Total health, and how fast it recovers between fights. */
  vigour: number;
  /** Movement speed and attack rate together. */
  speed: number;
  /**
   * How well it FIGHTS, as opposed to how hard it hits: range discipline, using cover, picking
   * the right target, knowing when to disengage. Feeds the utility brain's weights directly.
   */
  instinct: number;
}

export const STAT_NAMES: (keyof KaijuStats)[] = ['might', 'armour', 'vigour', 'speed', 'instinct'];

/** Plain-English labels, for the designer UI and the tracker. */
export const STAT_LABELS: Record<keyof KaijuStats, string> = {
  might: 'Might', armour: 'Armour', vigour: 'Vigour', speed: 'Speed', instinct: 'Instinct',
};

export const STAT_BLURBS: Record<keyof KaijuStats, string> = {
  might: 'How hard it hits',
  armour: 'How much damage it shrugs off',
  vigour: 'How much punishment it can take, and how fast it recovers',
  speed: 'How fast it moves and how often it attacks',
  instinct: 'How well it fights — cover, range, target choice, when to run',
};

// --- the budget ----------------------------------------------------------------------------------

/** Lowest a stat may go. Not zero: a Kaiju with no armour at all is a hole in the maths. */
export const STAT_MIN = 10;
/** The per-stat ceiling. THE most important balance rule here — see the note on tiers below. */
export const STAT_MAX = 100;

/**
 * Tiers. Each is a points budget and a per-stat cap, exactly like a Pokemon base stat total
 * bracket, and the cap is what stops a tier being "the same build but bigger".
 *
 * Raising the cap is a much bigger deal than raising the budget: budget lets you be good at more
 * things, cap lets you be better at one thing than anyone below your tier can be.
 */
export interface Tier { id: number; name: string; budget: number; cap: number }

export const TIERS: Tier[] = [
  { id: 1, name: 'Whelp',     budget: 150, cap: 45 },
  { id: 2, name: 'Prowler',   budget: 210, cap: 60 },
  { id: 3, name: 'Ravager',   budget: 275, cap: 75 },
  { id: 4, name: 'Titan',     budget: 340, cap: 90 },
  { id: 5, name: 'Worldbane', budget: 400, cap: 100 },
];

export function tierById(id: number): Tier { return TIERS.find((t) => t.id === id) ?? TIERS[2]; }

// --- abilities -----------------------------------------------------------------------------------
//
// WHY ABILITIES CARRY THE VARIETY, AND THE STATS DO NOT.
//
// Because combat value is a PRODUCT of damage and durability, a pure points budget has a single
// mathematical optimum: split it evenly. Any spread that is lopsided multiplies out to a smaller
// number than the balanced one. Left alone, a points system therefore pushes everyone toward the
// same middling build, which is the most boring possible outcome.
//
// This is exactly why Pokemon has types and abilities rather than just a stat total. Diversity has
// to come from rules that BREAK the maths in a specific situation — an ability that makes a glass
// cannon actually work by letting it strike first, or a slow tank work by punishing whoever comes
// close. So the abilities below are all conditional: each one is strong in a situation and dead
// weight outside it.

export type AbilityId =
  | 'regenerator' | 'berserker' | 'ambusher' | 'thickHide' | 'flameWard'
  | 'terrifying' | 'relentless' | 'amphibious' | 'sprinter' | 'bulwark';

export interface Ability {
  id: AbilityId;
  name: string;
  /** One line, as a player would read it. */
  text: string;
  /**
   * Points charged against the budget. NEGATIVE means it refunds — the ability is a genuine
   * drawback that buys stats elsewhere.
   */
  cost: number;
}

export const ABILITIES: Record<AbilityId, Ability> = {
  regenerator: {
    id: 'regenerator', name: 'Regenerator', cost: 25,
    text: 'Heals quickly once it breaks off a fight. Good for holding territory, useless in a duel.',
  },
  berserker: {
    id: 'berserker', name: 'Berserker', cost: 30,
    text: 'Hits harder the more hurt it is. Turns a losing fight into a coin flip.',
  },
  ambusher: {
    id: 'ambusher', name: 'Ambusher', cost: 25,
    text: 'Its first strike in a fight does double damage. The glass cannon’s ability.',
  },
  thickHide: {
    id: 'thickHide', name: 'Thick Hide', cost: 25,
    text: 'Extra protection from ranged fire only. Lets a slow bruiser cross open ground.',
  },
  flameWard: {
    id: 'flameWard', name: 'Flame Ward', cost: 15,
    text: 'Takes far less damage from fire. A hard counter, worthless against anything else.',
  },
  terrifying: {
    id: 'terrifying', name: 'Terrifying', cost: 30,
    text: 'Nearby enemies lose their nerve sooner and break off early.',
  },
  amphibious: {
    id: 'amphibious', name: 'Amphibious', cost: 30,
    text: 'No penalty underwater. Most of this world is ocean, so read that twice.',
  },
  sprinter: {
    id: 'sprinter', name: 'Sprinter', cost: 20,
    text: 'A burst of speed when closing on an enemy. Gets short-ranged weapons into range.',
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', cost: 20,
    text: 'Much tougher while standing its ground, much softer while running.',
  },
  relentless: {
    id: 'relentless', name: 'Relentless', cost: -35,
    text: 'It will never break off a fight, whatever the odds. Refunds points, and it will get it killed.',
  },
};

export const ABILITY_LIST = Object.values(ABILITIES);

// --- obedience -----------------------------------------------------------------------------------

/**
 * How readily it does what you tell it. 0 = wild, 100 = does it instantly whatever the odds.
 *
 * This is the axis Geoff asked for, and it is a genuine two-way trade rather than a stat you just
 * want more of: a high-obedience Kaiju follows an order into a fight its own judgement would have
 * refused, so it dies more. That is why it REFUNDS points. An obedient Kaiju is a worse survivor
 * and you are compensated for it in stats; a wilful one keeps itself alive and costs you the
 * ability to direct it.
 */
export const OBEDIENCE_DEFAULT = 50;

/** Points refunded (positive) or charged (negative) for a given obedience. */
export function obedienceAdjustment(obedience: number): number {
  // Linear about the midpoint. At 100 obedience you get 40 points back; at 0 you pay 40.
  return Math.round(((obedience - OBEDIENCE_DEFAULT) / OBEDIENCE_DEFAULT) * 40);
}

// --- a complete design ---------------------------------------------------------------------------

export interface KaijuBuild {
  name: string;
  tier: number;
  stats: KaijuStats;
  abilities: AbilityId[];
  obedience: number;
  weapon: WeaponId;
  /** Catalog monster type, purely cosmetic. */
  monsterType: number;
}

/** Points a build actually spends. Must not exceed the tier budget. */
export function pointsSpent(b: KaijuBuild): number {
  const stats = STAT_NAMES.reduce((n, k) => n + b.stats[k], 0);
  const abilities = b.abilities.reduce((n, a) => n + ABILITIES[a].cost, 0);
  return stats + abilities - obedienceAdjustment(b.obedience);
}

export interface Validation { ok: boolean; problems: string[]; spent: number; budget: number }

/** Everything that makes a build illegal, in words a player can act on. */
export function validateBuild(b: KaijuBuild): Validation {
  const tier = tierById(b.tier);
  const problems: string[] = [];
  const spent = pointsSpent(b);

  if (spent > tier.budget) problems.push(`${spent - tier.budget} points over budget`);
  for (const k of STAT_NAMES) {
    const v = b.stats[k];
    if (v > tier.cap) problems.push(`${STAT_LABELS[k]} is ${v}, above the ${tier.name} cap of ${tier.cap}`);
    if (v < STAT_MIN) problems.push(`${STAT_LABELS[k]} is ${v}, below the minimum of ${STAT_MIN}`);
  }
  if (b.abilities.length > 2) problems.push('At most two abilities');
  if (new Set(b.abilities).size !== b.abilities.length) problems.push('The same ability twice');
  if (b.obedience < 0 || b.obedience > 100) problems.push('Obedience must be 0 to 100');

  return { ok: problems.length === 0, problems, spent, budget: tier.budget };
}

// --- derived numbers, which are what the simulation actually reads --------------------------------

/** Health of a Kaiju with no Vigour at all, so the scale is anchored somewhere. */
export const BASE_HEALTH = 700;

export interface DerivedStats {
  maxHealth: number;
  /** Fraction of incoming damage removed, 0..1, never 1. */
  damageReduction: number;
  /** Health after armour is accounted for. The durability half of combat value. */
  effectiveHealth: number;
  /** Multiplier on all outgoing damage. */
  damageMul: number;
  /** Multiplier on attack RATE (cooldowns are divided by this). */
  rateMul: number;
  /** Multiplier on movement speed. */
  moveMul: number;
  /** Health regained per second once out of combat. */
  regenPerSec: number;
  /** 0..1 quality of tactical decisions. Feeds the brain's weights. */
  instinct01: number;
  /** 0..1, how strongly a player's order biases the utility scores. */
  obedience01: number;
}

/**
 * MOBA armour curve. Reduction rises with diminishing returns and never reaches 1, which means
 * armour can always be stacked but never becomes invulnerability.
 *
 * The tidy consequence: effective health is exactly health x (1 + armour/100), so a point of
 * armour and a point of health are the same currency and neither can run away from the other.
 */
export function damageReduction(armour: number): number {
  return armour / (armour + 100);
}

export function derive(b: KaijuBuild): DerivedStats {
  const s = b.stats;
  const maxHealth = BASE_HEALTH * (0.5 + s.vigour / 100);
  const reduction = damageReduction(s.armour);
  return {
    maxHealth,
    damageReduction: reduction,
    effectiveHealth: maxHealth / (1 - reduction),
    damageMul: 0.5 + s.might / 100,          // 0.6 .. 1.5
    rateMul: 0.7 + (s.speed / 100) * 0.6,    // 0.76 .. 1.3
    moveMul: 0.75 + (s.speed / 100) * 0.5,   // 0.80 .. 1.25
    regenPerSec: (maxHealth * 0.01) * (s.vigour / 100)
      * (b.abilities.includes('regenerator') ? 4 : 1),
    instinct01: s.instinct / 100,
    obedience01: b.obedience / 100,
  };
}

/**
 * POWER LEVEL — one number for how strong a build is.
 *
 * damage-per-second x effective-health, which is the RTS combat-value form: output only counts for
 * as long as you survive to produce it. Scaled to land near 100 for a mid-tier build so the number
 * means something at a glance.
 *
 * IMPORTANT, AND THE REASON THE BATCH SIMULATOR EXISTS: this is a PREDICTION, not the truth. It
 * knows nothing about weapon range, about Instinct, or about abilities that only fire in certain
 * situations. Its job is to be a good first guess that the simulator then corrects. Anywhere the
 * measured win rate disagrees with this formula, the formula is wrong and the measurement is right.
 */
export function powerLevel(b: KaijuBuild): number {
  const d = derive(b);
  const w = WEAPONS[b.weapon];
  const weaponDps = (w.damage * w.count) / Math.max(0.05, w.cooldown);
  const dps = weaponDps * d.damageMul * d.rateMul;
  return Math.round((dps * d.effectiveHealth) / 1000);
}

/** Even split of a budget across the five stats, respecting the cap. The neutral baseline. */
export function evenBuild(tier: Tier): KaijuStats {
  const each = Math.min(tier.cap, Math.floor(tier.budget / STAT_NAMES.length));
  return { might: each, armour: each, vigour: each, speed: each, instinct: each };
}

// --- breeds --------------------------------------------------------------------------------------
//
// Hand-designed presets. A new player buys one of these and plays; the custom designer is for
// later. Every one is a legal Ravager-tier build, and each is deliberately a different SHAPE rather
// than a different amount, because the shape is the interesting part.

export const BREEDS: KaijuBuild[] = [
  {
    // The wall. Slow and dim, but very hard to remove from a position.
    name: 'Bastion', tier: 3, monsterType: 17, weapon: 'flame', obedience: 60,
    stats: { might: 55, armour: 75, vigour: 70, speed: 25, instinct: 30 },
    abilities: ['bulwark'],
  },
  {
    // Glass cannon. Hits first, hits hard, dies if the opening blow does not land.
    name: 'Reaver', tier: 3, monsterType: 15, weapon: 'grenade', obedience: 40,
    stats: { might: 75, armour: 20, vigour: 30, speed: 62, instinct: 55 },
    abilities: ['ambusher'],
  },
  {
    // The professional. No standout numbers, but it plays properly and picks its ground.
    name: 'Sentinel', tier: 3, monsterType: 16, weapon: 'gun', obedience: 70,
    stats: { might: 50, armour: 45, vigour: 50, speed: 40, instinct: 75 },
    abilities: ['thickHide'],
  },
  {
    // Made for the ocean, which is most of this planet.
    name: 'Drowned', tier: 3, monsterType: 15, weapon: 'flame', obedience: 30,
    stats: { might: 60, armour: 35, vigour: 44, speed: 50, instinct: 40 },
    abilities: ['amphibious'],
  },
  {
    // Does exactly what it is told and never runs. Pays for that with everything else.
    // Red Demon, so the four in the demo fight are four visibly different creatures.
    name: 'Martyr', tier: 3, monsterType: 8, weapon: 'gun', obedience: 100,
    stats: { might: 75, armour: 60, vigour: 75, speed: 40, instinct: 20 },
    abilities: ['relentless', 'berserker'],
  },
];

/** A build's headline description, for the shop and the tracker. */
export function describeBuild(b: KaijuBuild): string {
  const v = validateBuild(b);
  const abil = b.abilities.map((a) => ABILITIES[a].name).join(' + ') || 'none';
  return `${b.name} (${tierById(b.tier).name}) — power ${powerLevel(b)}, ${v.spent}/${v.budget} points, `
    + `${WEAPONS[b.weapon].name}, abilities: ${abil}, obedience ${b.obedience}`;
}
