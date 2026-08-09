// kaijuBurn — fire that sticks to the part of the creature it landed on, and travels with it.
//
// Geoff: "the flame should burn for some time on the kaiju's mesh if it hits... The particular body
// part needs to burn and on the mesh... and if that kaiju is moving or walking or animating, the
// fire needs to move with them."
//
// THE WHOLE PROBLEM IS THAT WORLD POSITIONS ARE WRONG THE INSTANT ANYTHING MOVES. Fire recorded at
// the point where a flame particle struck is fire hanging in the air a second later, with the Kaiju
// walking out from under it. It has to be attached to the creature — and not to the creature as a
// whole either, because an arm that swings has moved thirty metres while the body has not.
//
// So a burn is stored as a position IN THE LOCAL SPACE OF THE NEAREST BONE. The nearest bone is
// found once, at ignition; from then on the flame's world position is just that bone's current
// matrix applied to a fixed offset. A burning shoulder burns on the shoulder through a walk, a
// swing and a death. Nothing has to be re-fitted, and it costs one matrix multiply per flame per
// frame.
//
// WHY THE NEAREST BONE AND NOT THE TRIANGLE IT HIT. The triangle is more precise and completely
// useless: it is skinned, so its own position depends on up to four bones, and reproducing that per
// frame is the expensive per-vertex work this project already avoids. A bone is a rigid frame — one
// matrix — and at 300 m the difference between "on the shoulder" and "on this exact triangle of the
// shoulder" is under a metre.

import * as THREE from 'three';
import { bonesOf } from './kaijuMeshHit';
import { fxRand as rand } from './kaijuRandom';

/** How long a patch of fire stays alight, in seconds. Geoff asked for 10-15. */
const BURN_MIN = 10;
const BURN_MAX = 15;

/**
 * How many patches can be alight at once, across every Kaiju.
 *
 * A flamethrower lands hundreds of hits a second and each one wants to start a fire. The cap and the
 * MERGE below are what stop a ten-second burn from turning into ten thousand overlapping sprites.
 */
const MAX_BURNS = 96;

/**
 * Patches closer together than this, on the same bone, are treated as one fire that got bigger.
 *
 * 12 m on a 300 m creature. Without it a jet held on one spot spawns a new sprite every frame and
 * they stack into a solid disc; with it, holding the jet there makes ONE fire grow and re-light,
 * which is what a fire being fed actually does.
 */
const MERGE_METRES = 12;
const METRES_PER_UNIT = 100;

export interface Burn {
  /** Which Kaiju is alight. */
  agentId: string;
  /** Index into that agent's bone list — the frame this fire is nailed to. */
  bone: number;
  /** Where the fire sits, in that bone's own local space. Fixed for the life of the burn. */
  local: THREE.Vector3;
  /** Recomputed every frame from the bone's current matrix. What the renderer draws. */
  world: THREE.Vector3;
  /** Radius in game units. Grows while the jet keeps feeding it. */
  size: number;
  age: number;
  life: number;
  /** Random phase so two fires on one creature do not flicker in lockstep. */
  seed: number;
  live: boolean;
}

const burns: Burn[] = [];
for (let i = 0; i < MAX_BURNS; i++) {
  burns.push({
    agentId: '', bone: 0, local: new THREE.Vector3(), world: new THREE.Vector3(),
    size: 0, age: 0, life: 0, seed: 0, live: false,
  });
}
let cursor = 0;

export const burnDiag = { lit: 0, merged: 0, ignitions: 0 };

export function getBurns(): Burn[] { return burns; }
export function clearBurns(agentId?: string): void {
  for (const b of burns) if (!agentId || b.agentId === agentId) b.live = false;
  if (!agentId) { burnDiag.lit = 0; burnDiag.merged = 0; burnDiag.ignitions = 0; }
}

const _inv = new THREE.Matrix4();
const _local = new THREE.Vector3();
const _bonePos = new THREE.Vector3();

/**
 * Set a patch of a Kaiju alight where a flame particle landed.
 *
 * `at` is the world-space point of contact. Returns false when the agent has no rig to attach to,
 * in which case there is nothing sensible to do — fire that cannot follow the body would be worse
 * than no fire.
 */
export function igniteMesh(agentId: string, at: THREE.Vector3, sizeUnits: number): boolean {
  const bones = bonesOf(agentId);
  if (!bones.length) return false;

  // Nearest bone, by world position. Linear over 30-60 bones and only on ignition.
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < bones.length; i++) {
    bones[i].getWorldPosition(_bonePos);
    const d = _bonePos.distanceToSquared(at);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return false;

  _inv.copy(bones[best].matrixWorld).invert();
  _local.copy(at).applyMatrix4(_inv);

  // FEED AN EXISTING FIRE RATHER THAN STARTING A NEW ONE. A jet held on one spot would otherwise
  // spawn a sprite every frame until the pool was full of them, all in the same place.
  const mergeLocal = (MERGE_METRES / METRES_PER_UNIT) / Math.max(1e-6, boneScale(bones[best]));
  for (const b of burns) {
    if (!b.live || b.agentId !== agentId || b.bone !== best) continue;
    if (b.local.distanceTo(_local) > mergeLocal) continue;
    b.size = Math.min(b.size * 1.06 + sizeUnits * 0.15, sizeUnits * 6);
    b.age = 0;                      // being fed keeps it burning
    burnDiag.merged++;
    return true;
  }

  const b = burns[cursor];
  cursor = (cursor + 1) % MAX_BURNS;
  b.agentId = agentId;
  b.bone = best;
  b.local.copy(_local);
  b.world.copy(at);
  b.size = sizeUnits * 1.8;
  b.age = 0;
  b.life = BURN_MIN + rand() * (BURN_MAX - BURN_MIN);
  b.seed = rand() * 1000;
  b.live = true;
  burnDiag.ignitions++;
  return true;
}

const _s = new THREE.Vector3();
function boneScale(bone: THREE.Object3D): number {
  bone.getWorldScale(_s);
  return _s.x;
}

/**
 * Age every fire and move it to wherever its bone is now. One owner, once a frame.
 *
 * This is the line that makes the fire travel with the animation: the local offset never changes,
 * so applying the bone's CURRENT matrix puts the flame back on the same patch of hide no matter
 * what the creature has done since.
 */
export function stepBurns(dt: number): void {
  let lit = 0;
  for (const b of burns) {
    if (!b.live) continue;
    b.age += dt;
    if (b.age > b.life) { b.live = false; continue; }
    const bones = bonesOf(b.agentId);
    const bone = bones[b.bone];
    if (!bone) { b.live = false; continue; }   // the model went away; so does its fire
    b.world.copy(b.local).applyMatrix4(bone.matrixWorld);
    lit++;
  }
  burnDiag.lit = lit;
}

/** How brightly a burn is going, 0-1. Flares up, holds, then gutters out. */
export function burnIntensity(b: Burn): number {
  const t = b.age / Math.max(1e-6, b.life);
  if (t < 0.06) return t / 0.06;              // catching
  if (t > 0.7) return Math.max(0, (1 - t) / 0.3);  // dying down
  return 1;
}
