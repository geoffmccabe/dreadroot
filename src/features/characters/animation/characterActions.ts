/**
 * One-shot ACTIONS layered over locomotion — shoot, reload, throw, hit, death,
 * landing.
 *
 * ── The design question this file answers ─────────────────────────────────────
 *
 * An action is not a replacement for movement. You keep running while you fire,
 * so firing has to play on the upper body while the legs carry on. three.js has
 * no bone masking, so there are two ways to do it and we use BOTH, chosen per
 * action:
 *
 *   ADDITIVE (shoot, reload, throw) — the clip is filtered to upper-body tracks
 *   and converted with AnimationUtils.makeClipAdditive, so it contributes the
 *   DELTA from its own first frame. Added on top of a run, you get the run plus
 *   the recoil. This is three.js's own documented approach for exactly this
 *   (see its additive-blending skinning example), not something invented here.
 *   Naively playing an unfiltered clip alongside locomotion instead blends the
 *   two 50/50 and produces mush, because the mixer weights every shared bone.
 *
 *   OVERRIDE (hit, death, land) — the clip takes the whole body, because it
 *   should. You do not keep strafing while you die.
 *
 * Death is the one that never times out: it holds its last frame until the
 * player respawns, so a corpse does not stand back up.
 */

export type ActionId = 'shoot' | 'reload' | 'throw' | 'hit' | 'death' | 'land' | 'climb' | 'vault';

export type ActionMode = 'additive' | 'override';

export const ACTION_MODE: Record<ActionId, ActionMode> = {
  shoot: 'additive',
  reload: 'additive',
  throw: 'additive',
  hit: 'override',
  death: 'override',
  land: 'override',
  // A climb owns the whole body — the legs are doing the work, so an additive
  // upper-body version would be nonsense. Same for a vault.
  climb: 'override',
  vault: 'override',
};

/** Actions that hold their final pose instead of releasing back to locomotion. */
export const ACTION_HOLDS: Record<ActionId, boolean> = {
  shoot: false, reload: false, throw: false, hit: false, land: false, climb: false, vault: false,
  death: true,
};

/** Higher wins when two actions land in the same frame. */
export const ACTION_PRIORITY: Record<ActionId, number> = {
  death: 100, hit: 60, climb: 50, vault: 50, land: 40, throw: 30, reload: 20, shoot: 10,
};

/**
 * Which bones count as "upper body" for an additive action.
 *
 * Deliberately matches BOTH rigs from one predicate: Mixamo names its bones
 * mixamorig:Spine / Neck / Head / *Shoulder / *Arm / *ForeArm / *Hand, while
 * the root rig uses Spine_01..03 / Neck / Head / Clavicle_L / Shoulder_L /
 * Elbow_L / Hand_L. Anything below the spine is left to locomotion.
 */
const UPPER = /(spine|neck|head|clavicle|shoulder|arm|forearm|elbow|hand|thumb|index|middle|ring|pinky|finger)/i;

export function isUpperBodyTrack(trackName: string): boolean {
  // Track names look like "<bone>.<property>" — only the bone half matters.
  const bone = trackName.split('.')[0];
  // Never let an additive clip move the character through the world: a Hips or
  // Root position track would fight the physics that owns the body's position.
  if (/^(root|hips)$/i.test(bone)) return false;
  return UPPER.test(bone);
}

interface Pending { id: ActionId; at: number; /** requested length in seconds, or undefined for as-authored */ seconds?: number; }

/**
 * Fire-and-forget action requests, keyed by who they belong to.
 *
 * A bus rather than props because the triggers are scattered across gameplay
 * code that has no reference to the avatar — the shooting hook, the reload
 * timer, the damage system — and threading a ref through all of them to play an
 * animation would be worse than a two-function module.
 */
const pending = new Map<string, Pending>();

/** The local player's key. Remote players use their user id. */
export const LOCAL_ACTOR = '__local';

/**
 * Anyone who wants to know when the LOCAL player performs an action — in
 * practice, the netcode, so other players see it too.
 *
 * A subscription rather than a call at each trigger site: the triggers are
 * scattered across the shooting hook, the reload timer, the grenade handlers
 * and the death effect, and making every one of them also remember to
 * broadcast is precisely how a feature ends up working for four of five
 * actions.
 */
/** 'revive' is not an animation — it is the signal that RELEASES the death
 *  pose. It travels the same path because a remote player who respawns would
 *  otherwise stay collapsed on everyone else's screen forever. */
export type ActionSignal = ActionId | 'revive';
type LocalActionListener = (id: ActionSignal) => void;
const localListeners = new Set<LocalActionListener>();

export function onLocalAction(fn: LocalActionListener): () => void {
  localListeners.add(fn);
  return () => { localListeners.delete(fn); };
}

/**
 * @param seconds how long the action should TAKE, when gameplay already knows.
 *   A climb is driven along a scripted path for a fixed time; the clip was
 *   authored at some other length entirely, and playing it unscaled means the
 *   body finishes the move and then carries on climbing thin air. Same fix as
 *   the reload below, which is matched to the weapon's real reload time.
 *   Omitted means "play it as authored", which is right for shoot/hit/death.
 */
export function triggerAction(id: ActionId, actor: string = LOCAL_ACTOR, seconds?: number): void {
  const now = performance.now();
  const cur = pending.get(actor);
  // Keep the more important of two requests in the same frame.
  if (cur && ACTION_PRIORITY[cur.id] > ACTION_PRIORITY[id] && now - cur.at < 50) return;
  pending.set(actor, { id, at: now, seconds });
  if (actor === LOCAL_ACTOR) {
    for (const fn of localListeners) {
      try { fn(id); } catch { /* a broken listener must never stop the animation */ }
    }
  }
}

export interface QueuedAction { id: ActionId; /** requested length, or undefined for as-authored */ seconds?: number }

/** Consume the queued action, if any. Returns null when there is nothing new. */
export function takeAction(actor: string = LOCAL_ACTOR): QueuedAction | null {
  const p = pending.get(actor);
  if (!p) return null;
  pending.delete(actor);
  // Stale requests are dropped: an action queued while the tab was hidden
  // should not fire a second later when it comes back.
  if (performance.now() - p.at > 250) return null;
  return { id: p.id, seconds: p.seconds };
}

export function clearActions(actor: string = LOCAL_ACTOR): void {
  pending.delete(actor);
}

/**
 * Death is the one action that holds its final frame forever, so something has
 * to let go of it. A counter rather than a flag: the animator compares the
 * value it last saw, which means a respawn is never missed because it happened
 * between two frames, and never double-applied.
 */
const revivals = new Map<string, number>();

export function reviveActor(actor: string = LOCAL_ACTOR): void {
  revivals.set(actor, (revivals.get(actor) ?? 0) + 1);
  pending.delete(actor);
  if (actor === LOCAL_ACTOR) {
    for (const fn of localListeners) {
      try { fn('revive'); } catch { /* never let a listener block a respawn */ }
    }
  }
}

export function revivalCount(actor: string = LOCAL_ACTOR): number {
  return revivals.get(actor) ?? 0;
}
