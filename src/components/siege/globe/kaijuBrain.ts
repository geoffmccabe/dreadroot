// kaijuBrain — the Kaiju decision layer: utility scoring for WHAT, Mistreevous for HOW.
//
// See docs/KAIJU_AI_RESEARCH.md for why this shape. Briefly: behaviour trees are good at ordered
// procedure and bad at choosing between many partly-applicable options; utility scoring is the
// reverse. So a utility pass picks the ACTION each think-tick, and a Mistreevous subtree runs it.
//
// EVERYTHING IS LOGGED. Every consideration's input and score, the winning action and why, and
// each state change, are recorded per agent so the tracker panel can show what the Kaiju actually
// knew and decided. An AI you cannot inspect is an AI you cannot tune, and this project has
// already lost days to not being able to see things.
//
// Considerations are multiplied, not summed: any single one scoring zero must VETO its action
// outright. "Flee" with a health consideration of zero at full health must not creep up just
// because several other factors are mildly favourable.

import * as THREE from 'three';
import { WEAPONS, type WeaponId } from './kaijuWeapons';

export type ActionId = 'engage' | 'ranged' | 'flee' | 'takeCover' | 'circle' | 'explore';

export interface Consideration {
  name: string;
  /** Raw reading, for the tracker. */
  input: number;
  /** After the response curve, 0..1. */
  score: number;
}

export interface ActionScore {
  action: ActionId;
  score: number;
  considerations: Consideration[];
}

/** Everything the brain is allowed to know. Keeping this explicit is what makes it inspectable. */
export interface Perception {
  selfId: string;
  healthFrac: number;
  /** Nearest living enemy. */
  targetId: string | null;
  /** Distance to target in BODY HEIGHTS, which is the only scale-free way to reason about range. */
  targetDistBodies: number;
  /** Their effective power over ours AT THE CURRENT RANGE: >1 means they out-gun us here. */
  powerRatio: number;
  /**
   * Their power over ours if we CLOSED to our own best range.
   *
   * Two numbers are needed, not one. A flamethrower Kaiju standing ten body-lengths from a cannon
   * is genuinely outgunned right now, and judging "should I engage?" on that made it refuse to
   * fight and wander off. The question engaging actually asks is "if I get in close, do I win?" —
   * and for the flamethrower the answer is emphatically yes. Retreating decisions use the current
   * ratio; committing decisions use this one.
   */
  powerRatioClosed: number;
  /** How many enemies are within a few body heights. */
  threatCount: number;
  /** Our weapon's effective range in body heights. */
  weaponRangeBodies: number;
  weapon: WeaponId;
  /** Is there terrain higher than us between us and the target? */
  coverNearby: boolean;
  timeSinceHit: number;
  /**
   * Tactical quality, 0..1, from the Instinct stat.
   *
   * This is the knob that makes a clever Kaiju and a stupid one behave differently WITHOUT
   * changing a single line of the decision code — which is the whole payoff of having built the
   * brain as a utility system. Low instinct blunts the considerations that require judgement:
   * it barely notices cover, it has no sense of its weapon's ideal range, and it is slow to
   * realise it is losing. High instinct reads all of them properly.
   */
  instinct: number;
  /**
   * How readily it obeys, 0..1. High obedience makes it hold its ground past the point its own
   * judgement would break off — which is exactly why it refunds points. It is the "more obedient
   * means more suicidal" trade, expressed as a weight on self-preservation.
   */
  obedience: number;
  /** Relentless: it never breaks off, whatever the odds. */
  neverFlees: boolean;
  /** Terrifying enemies nearby make it break off sooner. */
  fearPressure: number;
}

// --- response curves ---------------------------------------------------------------------------
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Rises from 0 at `lo` to 1 at `hi`. */
const ramp = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo || 1e-6));
/** Falls from 1 at `lo` to 0 at `hi`. */
const fall = (v: number, lo: number, hi: number) => 1 - ramp(v, lo, hi);
/** Peaks at `mid`, zero outside +/- `width`. Used for "stay at my ideal range". */
const band = (v: number, mid: number, width: number) => clamp01(1 - Math.abs(v - mid) / (width || 1e-6));

function con(name: string, input: number, score: number): Consideration {
  return { name, input: Math.round(input * 1000) / 1000, score: Math.round(score * 1000) / 1000 };
}

/**
 * Score every action. Highest wins.
 *
 * The comments on each consideration are the design intent in plain terms, because these curves
 * ARE the personality and they will be tuned by reading the tracker rather than by reasoning.
 */
export function scoreActions(p: Perception): ActionScore[] {
  const out: ActionScore[] = [];
  const hasTarget = p.targetId != null;
  const r = p.weaponRangeBodies;

  // Instinct blends a judgement call toward "no opinion". At instinct 0 a tactical consideration
  // returns a flat 0.5 no matter what the situation is, so the Kaiju simply does not weigh it; at
  // instinct 1 it reads the situation fully. Interpolating rather than gating keeps every score
  // continuous, which matters because the hysteresis works on score differences.
  const judge = (v: number) => 0.5 + (v - 0.5) * p.instinct;

  // Obedience suppresses self-preservation. At obedience 1 the survival routes score barely a
  // third of what they otherwise would, so it stays in fights it should leave — and dies in them.
  const selfPreservation = 1 - 0.65 * p.obedience;

  // FLEE: two separate routes, whichever is stronger.
  //
  // The first version summed the routes, so a FULL-HEALTH Kaiju facing a stronger enemy scored
  // 0.3 on flee and ran away immediately. Every fight ended with three Kaiju standing in three
  // corners. Being outmatched is a reason to retreat only once you are actually hurt; at full
  // health it is a reason to fight carefully. So the second route is multiplied by a health
  // term, and a zero there vetoes it outright.
  {
    // Route 1: desperation. This is Geoff's headline rule, "under 10% health, turn and run",
    // and it depends on nothing else so nothing can suppress it.
    const desperate = fall(p.healthFrac, 0.10, 0.35);
    // Route 2: losing badly. Outgunned AND hurt AND, worse, outnumbered.
    const outmatched = ramp(p.powerRatio, 1.1, 2.2);
    const hurt = fall(p.healthFrac, 0.40, 0.85);
    const swarmed = 1 + 0.5 * ramp(p.threatCount, 1, 3);
    const losing = Math.min(1, judge(outmatched) * hurt * swarmed);
    // A frightened Kaiju breaks off sooner; Relentless never does at all.
    const scared = 1 + p.fearPressure;
    const raw = Math.max(desperate, losing * 0.8) * scared * selfPreservation;
    const score = p.neverFlees ? 0 : Math.min(1, raw) * (hasTarget ? 1 : 0);
    out.push({
      action: 'flee', score,
      considerations: [
        con('healthFrac', p.healthFrac, desperate),
        con('powerRatio', p.powerRatio, outmatched),
        con('hurtEnough', p.healthFrac, hurt),
        con('threatCount', p.threatCount, swarmed - 1),
      ],
    });
  }

  // TAKE COVER: outmatched but not yet desperate, and there is somewhere to hide.
  {
    const outmatched = ramp(p.powerRatio, 1.05, 1.8);
    const hurtish = fall(p.healthFrac, 0.25, 0.75);
    const cover = p.coverNearby ? 1 : 0;                   // hard veto: no cover, no cover-seeking
    const notPointBlank = ramp(p.targetDistBodies, 1.5, 4);
    // Using cover is the most judgement-dependent thing here, so it is the most blunted by low
    // Instinct: a stupid Kaiju stands in the open.
    const score = judge(outmatched) * hurtish * cover * notPointBlank * p.instinct
      * selfPreservation * (hasTarget ? 1 : 0);
    out.push({
      action: 'takeCover', score,
      considerations: [
        con('powerRatio', p.powerRatio, outmatched),
        con('healthFrac', p.healthFrac, hurtish),
        con('coverNearby', cover, cover),
        con('distBodies', p.targetDistBodies, notPointBlank),
      ],
    });
  }

  // RANGED: hold at my weapon's sweet spot. Meaningless for a melee-range weapon.
  {
    const ideal = r * 0.7;
    // Range discipline — holding at your weapon's sweet spot — is skill. Low instinct has none.
    const inBand = r > 3 ? judge(band(p.targetDistBodies, ideal, r * 0.6)) : 0;
    const healthy = ramp(p.healthFrac, 0.15, 0.5);
    const score = inBand * healthy * (hasTarget ? 1 : 0);
    out.push({
      action: 'ranged', score,
      considerations: [
        con('distBodies', p.targetDistBodies, inBand),
        con('weaponRange', r, r > 3 ? 1 : 0),
        con('healthFrac', p.healthFrac, healthy),
      ],
    });
  }

  // ENGAGE: close the distance and hit it. This is also the PURSUIT action, which is why its
  // distance consideration never reaches zero.
  //
  // It used to fall to zero beyond ~3.5x weapon range, and that was a real bug: a flamethrower
  // Kaiju (range 2.2 bodies) starting 10 bodies away scored zero on engage, zero on ranged and
  // zero on circle, so `explore` won and it wandered off instead of fighting. A short-range
  // fighter must always be willing to walk toward its enemy; distance should make engaging less
  // PREFERRED than shooting, never impossible.
  {
    const near = 0.35 + 0.65 * fall(p.targetDistBodies, r * 0.9, r * 3.5);
    const healthy = ramp(p.healthFrac, 0.2, 0.55);
    // Knowing you would win up close is judgement too; a dim Kaiju charges regardless.
    const notOutmatched = judge(fall(p.powerRatioClosed, 1.2, 2.0));
    const score = near * healthy * notOutmatched * (hasTarget ? 1 : 0);
    out.push({
      action: 'engage', score,
      considerations: [
        con('distBodies', p.targetDistBodies, near),
        con('healthFrac', p.healthFrac, healthy),
        con('powerIfClosed', p.powerRatioClosed, notOutmatched),
      ],
    });
  }

  // CIRCLE: strafe around the target. Fills the gap between "too close to shoot" and "committed".
  {
    const midRange = band(p.targetDistBodies, r * 1.2, r * 1.0);
    const healthy = ramp(p.healthFrac, 0.3, 0.6);
    out.push({
      action: 'circle', score: midRange * healthy * 0.55 * (hasTarget ? 1 : 0),
      considerations: [con('distBodies', p.targetDistBodies, midRange), con('healthFrac', p.healthFrac, healthy)],
    });
  }

  // EXPLORE: nothing to fight. Deliberately a low constant so anything else outranks it.
  out.push({
    action: 'explore', score: hasTarget ? 0.05 : 0.4,
    considerations: [con('hasTarget', hasTarget ? 1 : 0, hasTarget ? 0 : 1)],
  });

  return out.sort((a, b) => b.score - a.score);
}

/** Hysteresis: do not switch action unless the challenger is meaningfully better. */
export const SWITCH_MARGIN = 0.12;

/**
 * Minimum seconds to stay in an action before reconsidering.
 *
 * A score margin ALONE does not stop dithering, which the headless fight showed clearly: the
 * grenade Kaiju alternated engage/circle on consecutive frames for seven seconds, because each
 * action moved it into the distance band where the other one wins. The standard fix is a
 * commitment window as well as a margin, so an action gets long enough to actually accomplish
 * something before the scores are allowed to overrule it.
 *
 * Fleeing is exempt: "under 10% health, turn and run" must never wait out a timer.
 */
export const MIN_DWELL_SECONDS = 1.2;

export function chooseAction(
  scores: ActionScore[], current: ActionId | null, timeInAction = Infinity,
): ActionScore {
  const best = scores[0];
  if (!current) return best;
  const cur = scores.find((s) => s.action === current);
  if (!cur) return best;
  // Emergencies interrupt immediately; everything else waits out the commitment window.
  const urgent = best.action === 'flee' && best.score > cur.score + SWITCH_MARGIN;
  if (!urgent && timeInAction < MIN_DWELL_SECONDS) return cur;
  return best.score > cur.score + SWITCH_MARGIN ? best : cur;
}

/**
 * The Mistreevous tree for each action, as MDSL.
 *
 * Kept as text rather than code on purpose: it is the layer meant to be readable and editable by
 * Geoff, and it is also the form an LLM can emit and we can validate (see the research doc).
 */
export const ACTION_TREES: Record<ActionId, string> = {
  engage: `root {
    sequence {
      condition [HasTarget]
      selector {
        sequence { condition [InMeleeRange] action [FaceTarget] action [MeleeAttack] }
        sequence { condition [InWeaponRange] action [FaceTarget] action [FireWeapon] }
        action [MoveToTarget]
      }
    }
  }`,
  ranged: `root {
    sequence {
      condition [HasTarget]
      action [FaceTarget]
      selector {
        sequence { condition [TooClose] action [BackAway] }
        sequence { condition [InWeaponRange] action [FireWeapon] }
        action [MoveToTarget]
      }
    }
  }`,
  flee: `root {
    sequence { condition [HasTarget] action [FaceAwayFromTarget] action [RunAway] }
  }`,
  takeCover: `root {
    sequence { condition [HasTarget] action [MoveToCover] action [FaceTarget] }
  }`,
  circle: `root {
    sequence { condition [HasTarget] action [FaceTarget] action [Strafe] }
  }`,
  explore: `root {
    sequence { action [Wander] }
  }`,
};

/** One line per decision, for the tracker panel. */
export interface DecisionLog {
  t: number;
  agent: string;
  action: ActionId;
  score: number;
  reason: string;
}

export function describeChoice(a: ActionScore): string {
  const top = a.considerations.slice().sort((x, y) => y.score - x.score)[0];
  return top ? `${a.action} (${a.score.toFixed(2)}) driven by ${top.name}=${top.input}` : a.action;
}

export function weaponRangeBodies(w: WeaponId): number { return WEAPONS[w].rangeBodies; }
export const _vec = new THREE.Vector3();
