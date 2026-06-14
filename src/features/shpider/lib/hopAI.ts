// Shpider AI — idle → crawl (stalk) → hop (pounce).
//
// Behaviour model is a classic ambush-predator loop borrowed from
// games like Resident Evil's chargers and Skyrim's frostbite spiders:
//
//   1. Hold still (idle) — surveying the area.
//   2. Crawl a short distance toward the player (stalking phase).
//      Most of the random / unpredictable behavior lives here.
//   3. Launch into a fast parabolic pounce (hop).
//   4. Land, snap orientation to the new surface, restart.
//
// Movement is fully 3D: the crawl uses the shpider's current surface
// tangent plane, and the hop's landing point can be on a block's top,
// side, or ceiling (whichever voxel face the target ray hits).

import * as THREE from 'three';
import type { ShpiderInstance } from '../types';
import { findGroundY, pickTreeAwareTarget, findAdjacentWall } from './surfaceDetect';
import { playGroundImpact, GROUND_IMPACT_MIN_SPEED } from '@/features/enemies/audio/groundImpactSound';
import { SHPIDER_MIN_TARGET_SPACING } from '../constants';
import { EnemyManager } from '@/features/enemies/ai/EnemyManager';
import { playSpatialSound } from '@/lib/spatialAudio';
import { isPointInFSZ, FSZ_MIN_X, FSZ_MAX_X, FSZ_MIN_Z, FSZ_MAX_Z } from '@/features/enemies/ai/fortressSafeZone';

// Slow walk-out speed when a shpider is knocked into the fortress safe zone.
const FSZ_ESCAPE_SPEED = 3; // blocks/s

const _normalScratch = new THREE.Vector3();
const _posScratch = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _tangentA = new THREE.Vector3();
const _tangentB = new THREE.Vector3();

const CRAWL_SPEED = 1.5; // blocks/sec along surface tangent
const CRAWL_MIN_MS = 800;
const CRAWL_MAX_MS = 2400;
const FALL_GRAVITY = 18.0; // blocks/s² while in mid-air (no support)
const WORLD_FLOOR_Y = 0;   // hard floor of the playable world

// Default hop sound (used when the per-tier hop_sound_url is null).
// File is copied to /public so it ships with the build.
const DEFAULT_HOP_SOUND_URL = '/shpider_jump.mp3';
// 50% of native volume per design.
const HOP_BASE_VOLUME = 0.5;
// Play all shpider sounds an octave-ish lower (half pitch) per design.
const SHPIDER_PITCH = 0.5;

/**
 * Play the per-shpider hop sound through the shared spatial-audio
 * module so distant shpiders are quiet and overlapping plays use
 * Web Audio buffer sources (no HTMLAudio leak risk, automatic mix).
 */
function playHopSound(
  url: string | null | undefined,
  spX: number, spY: number, spZ: number,
  listenerX: number, listenerY: number, listenerZ: number,
) {
  if (typeof window === 'undefined') return;
  const finalUrl = url && url.length > 0 ? url : DEFAULT_HOP_SOUND_URL;
  const dist = Math.hypot(spX - listenerX, spY - listenerY, spZ - listenerZ);
  void playSpatialSound(finalUrl, dist, { baseVolume: HOP_BASE_VOLUME, playbackRate: SHPIDER_PITCH });
}

export interface StepDeps {
  playerX: number;
  playerY: number;
  playerZ: number;
  now: number;
  dt: number; // seconds since last frame
  /** Active shpider list (for anti-overlap target rejection). */
  others?: readonly ShpiderInstance[];
}

/** True if the candidate (x,z) is too close to another active shpider.
 *  Queries the shared enemy index (filtered to shpiders). */
function isTooCrowded(
  x: number, z: number, self: ShpiderInstance,
  _others?: readonly ShpiderInstance[], // kept for signature compat; unused
): boolean {
  const near = EnemyManager.getSpatialIndex().getNearby(x, z, SHPIDER_MIN_TARGET_SPACING);
  for (let i = 0; i < near.length; i++) {
    const n = near[i];
    if (n.type === 'shpider' && n.id !== self.id) return true;
  }
  return false;
}

/**
 * Inspect the vertical stack of shpiders sharing this column with
 * `self`. Returns the count INCLUDING self and whether anyone is
 * directly above. "Same column" = within bodySize × 0.9 in XZ.
 */
export function analyzeStack(
  self: ShpiderInstance,
  _others?: readonly ShpiderInstance[], // kept for signature compat; unused
): { count: number; hasAbove: boolean } {
  const r = self.definition.body_size * 0.9;
  let count = 1;
  let hasAbove = false;
  const near = EnemyManager.getSpatialIndex().getNearby(self.position.x, self.position.z, r);
  for (let i = 0; i < near.length; i++) {
    const n = near[i];
    if (n.type !== 'shpider' || n.id === self.id) continue;
    count++;
    if (n.y > self.position.y + 0.2) hasAbove = true;
  }
  return { count, hasAbove };
}

/**
 * Build two orthogonal tangent vectors for the current surface normal.
 * tangentA points roughly forward, tangentB points roughly sideways.
 */
function getSurfaceTangents(normal: THREE.Vector3, outA: THREE.Vector3, outB: THREE.Vector3) {
  // Pick the world axis least parallel to normal as our seed.
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ay < ax && ay < az) {
    outA.set(0, 1, 0);
  } else if (ax < az) {
    outA.set(1, 0, 0);
  } else {
    outA.set(0, 0, 1);
  }
  // outA = outA × normal × normal (Gram-Schmidt → orthogonal to normal)
  outA.sub(_normalScratch.copy(normal).multiplyScalar(outA.dot(normal))).normalize();
  outB.crossVectors(normal, outA).normalize();
}

// ────────────────────────────────────────────────────────────────────────────
// Phase functions — the shpider's EXECUTION, split out of the monolithic step so
// BOTH the legacy FSM orchestrator (below) AND the behavior tree (ai/shpiderTree)
// call the exact same code in the exact same priority. One source of truth →
// the two paths are behaviorally identical; the BT is pure re-orchestration.
// ────────────────────────────────────────────────────────────────────────────

/** Knockback integration + decay (halflife ~0.25s). Always runs, every phase. */
export function applyKnockback(s: ShpiderInstance, dt: number): void {
  if (s.velocity.x !== 0 || s.velocity.z !== 0) {
    s.position.x += s.velocity.x * dt;
    s.position.z += s.velocity.z * dt;
    const decay = Math.pow(0.5, dt * 4); // halflife = 0.25s
    s.velocity.x *= decay;
    s.velocity.z *= decay;
    if (Math.abs(s.velocity.x) < 0.05) s.velocity.x = 0;
    if (Math.abs(s.velocity.z) < 0.05) s.velocity.z = 0;
  }
}

/**
 * Gravity guard for grounded phases (idle/crawling on a flat-up surface). Runs
 * an airborne shpider down to the nearest block top / enemy top / world floor.
 * Returns TRUE if airborne this tick — the caller must then skip phase logic.
 */
export function gravityStep(s: ShpiderInstance, deps: StepDeps): boolean {
  const { dt } = deps;
  if (!((s.hop.phase === 'idle' || s.hop.phase === 'crawling') && s.surfaceNormal.y > 0.9)) {
    return false;
  }
  const probedGround = findGroundY(s.position.x, s.position.y + 0.5, s.position.z, 64);
  let supportY = probedGround === -Infinity ? WORLD_FLOOR_Y : probedGround;
  // Jump/land on top of another enemy (shroomer/shombie) if it's higher.
  if (s.velocity.y <= 0) {
    const eTop = EnemyManager.getStandableTopNear(
      s.position.x, s.position.z, s.position.y, 0.5, s.id,
      (s.definition.body_size ?? 1) * (s.scale ?? 1) * 0.5,
    );
    if (eTop != null && eTop > supportY) supportY = eTop;
  }
  // Airborne if above support OR carrying a positive upward impulse (blast kick).
  const airborne = (s.position.y - supportY > 0.05) || s.velocity.y > 0;
  if (airborne) {
    s.velocity.y -= FALL_GRAVITY * dt;
    s.position.y += s.velocity.y * dt;
    if (s.position.y <= supportY) {
      // Hard landing (blast-fall / tree-drop) plays the ground-impact sound.
      if (-s.velocity.y > GROUND_IMPACT_MIN_SPEED) {
        playGroundImpact(s.position.x, supportY, s.position.z);
      }
      s.position.y = supportY;
      s.velocity.y = 0;
    }
    return true;
  }
  // Resting on support — clear tiny residual downward velocity.
  if (s.velocity.y < 0) s.velocity.y = 0;
  return false;
}

/** FSZ escape: a shpider knocked into the fortress safe zone walks to the
 *  nearest edge and out (ignores the hop throttle). */
export function escapeFSZ(s: ShpiderInstance, deps: StepDeps): void {
  const { dt } = deps;
  const dMinX = s.position.x - FSZ_MIN_X;
  const dMaxX = FSZ_MAX_X - s.position.x;
  const dMinZ = s.position.z - FSZ_MIN_Z;
  const dMaxZ = FSZ_MAX_Z - s.position.z;
  const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
  let dirX = 0, dirZ = 0;
  if (minD === dMinX) dirX = -1;
  else if (minD === dMaxX) dirX = 1;
  else if (minD === dMinZ) dirZ = -1;
  else dirZ = 1;
  const step = FSZ_ESCAPE_SPEED * dt;
  s.position.x += dirX * step;
  s.position.z += dirZ * step;
  s.rotation = Math.atan2(dirX, dirZ);
}

/**
 * IDLE decision: respect the hop throttle + stacking rules, then either set up a
 * short stalking crawl (60%) or pounce immediately (40%).
 */
export function decideIdleAction(s: ShpiderInstance, deps: StepDeps): void {
  const { now, playerX, playerY, playerZ } = deps;
  if (now < s.hop.nextHopAt) return;

  // Stacking: shpiders carrying another on top freeze; tops of a column hop 20× less.
  const stack = analyzeStack(s, deps.others);
  if (stack.hasAbove) {
    s.hop.nextHopAt = now + 1500;
    return;
  }
  if (stack.count > 1) {
    if (Math.random() >= 1 / 20) {
      s.hop.nextHopAt = now + 1500;
      return;
    }
  }

  // 60% short stalking crawl first; 40% straight pounce. Randomness so groups
  // don't move in lock-step.
  const shouldCrawl = Math.random() < 0.6;
  if (shouldCrawl) {
    getSurfaceTangents(s.surfaceNormal, _tangentA, _tangentB);

    // Direction in tangent plane: 70% biased toward player, 30% random.
    let dirA: number;
    let dirB: number;
    if (Math.random() < 0.7) {
      _toPlayer.set(playerX - s.position.x, playerY - s.position.y, playerZ - s.position.z);
      const da = _toPlayer.dot(_tangentA);
      const db = _toPlayer.dot(_tangentB);
      const m = Math.hypot(da, db) || 1;
      const jitter = (Math.random() - 0.5) * 1.0;
      const c = Math.cos(jitter);
      const sn = Math.sin(jitter);
      dirA = (da / m) * c - (db / m) * sn;
      dirB = (da / m) * sn + (db / m) * c;
    } else {
      const angle = Math.random() * Math.PI * 2;
      dirA = Math.cos(angle);
      dirB = Math.sin(angle);
    }

    const duration = CRAWL_MIN_MS + Math.random() * (CRAWL_MAX_MS - CRAWL_MIN_MS);
    const distance = (CRAWL_SPEED * duration) / 1000;
    let endX = s.position.x + (_tangentA.x * dirA + _tangentB.x * dirB) * distance;
    let endZ = s.position.z + (_tangentA.z * dirA + _tangentB.z * dirB) * distance;

    // Anti-overlap: shorten the crawl if it would land on another shpider.
    let retries = 4;
    while (retries-- > 0 && isTooCrowded(endX, endZ, s, deps.others)) {
      endX = (endX + s.position.x) * 0.5;
      endZ = (endZ + s.position.z) * 0.5;
    }
    // Fortress Safe Zone: cancel any crawl endpoint that would breach the FSZ.
    if (isPointInFSZ(endX, 0, endZ)) {
      endX = s.position.x;
      endZ = s.position.z;
    }

    s.hop.phase = 'crawling';
    s.hop.crawlStartAt = now;
    s.hop.crawlDurationMs = duration;
    s.hop.crawlStartX = s.position.x;
    s.hop.crawlStartZ = s.position.z;
    s.hop.crawlEndX = endX;
    s.hop.crawlEndZ = endZ;

    // Face crawl direction so legs orient.
    const fdx = endX - s.position.x;
    const fdz = endZ - s.position.z;
    if (fdx !== 0 || fdz !== 0) s.rotation = Math.atan2(fdx, fdz);
    return;
  }

  // Skip straight to a pounce.
  launchHop(s, deps);
}

/** CRAWLING: slow linear lerp along the tangent plane; pounce when complete. */
export function continueCrawl(s: ShpiderInstance, deps: StepDeps): void {
  const { now } = deps;
  const t = Math.min(1, (now - s.hop.crawlStartAt) / s.hop.crawlDurationMs);
  s.position.x = s.hop.crawlStartX + (s.hop.crawlEndX - s.hop.crawlStartX) * t;
  s.position.z = s.hop.crawlStartZ + (s.hop.crawlEndZ - s.hop.crawlStartZ) * t;
  if (t >= 1) {
    // Crawl done → pounce immediately.
    launchHop(s, deps);
  }
}

/** HOPPING: parabolic arc; on landing snap the surface normal, wall-attach,
 *  reschedule the next hop. */
export function continueHop(s: ShpiderInstance, deps: StepDeps): void {
  const { now } = deps;
  const def = s.definition;
  const t = Math.min(1, (now - s.hop.hopStartAt) / s.hop.hopDurationMs);
  s.position.x = s.hop.startX + (s.hop.endX - s.hop.startX) * t;
  s.position.z = s.hop.startZ + (s.hop.endZ - s.hop.startZ) * t;
  s.position.y = s.hop.startY + (s.hop.endY - s.hop.startY) * t
              + s.hop.arcHeight * Math.sin(Math.PI * t);

  if (t >= 1) {
    s.position.x = s.hop.endX;
    s.position.y = s.hop.endY;
    s.position.z = s.hop.endZ;
    s.surfaceNormal.set(s.hop.endNormalX, s.hop.endNormalY, s.hop.endNormalZ);

    // Wall-attach: snap to an adjacent trunk/wall so the shpider becomes a
    // wall-crawler that climbs toward the player.
    if (findAdjacentWall(s.position.x, s.position.y, s.position.z, _normalScratch)) {
      s.surfaceNormal.copy(_normalScratch);
    }

    s.hop.phase = 'idle';
    s.hop.nextHopAt = now + def.hop_interval_min_ms
                    + Math.random() * (def.hop_interval_max_ms - def.hop_interval_min_ms);
    s.velocity.set(0, 0, 0);
  }
}

/**
 * Advance one shpider for the current frame. Mutates instance fields.
 *
 * LEGACY orchestrator (fallback path). The behavior tree in ai/shpiderTree.ts
 * drives these SAME phase functions in the SAME priority, so the two are
 * behaviorally identical — this stays as a one-flag rollback.
 */
export function stepShpiderHopAI(s: ShpiderInstance, deps: StepDeps): void {
  applyKnockback(s, deps.dt);
  if (gravityStep(s, deps)) return;

  if (s.hop.phase === 'idle') {
    if (isPointInFSZ(s.position.x, 0, s.position.z)) {
      escapeFSZ(s, deps);
      return;
    }
    decideIdleAction(s, deps);
    return;
  }

  if (s.hop.phase === 'crawling') {
    continueCrawl(s, deps);
    return;
  }

  continueHop(s, deps);
}

/**
 * Pick a hop target (tree-aware) and set state to 'hopping'.
 */
function launchHop(s: ShpiderInstance, deps: StepDeps): void {
  const { now, playerX, playerY, playerZ } = deps;
  const def = s.definition;

  // Up to 4 picks — reject any landing that overlaps another shpider.
  let endX = s.position.x;
  let endY = s.position.y;
  let endZ = s.position.z;
  let endNX = 0;
  let endNY = 1;
  let endNZ = 0;
  let accepted = false;
  for (let tries = 0; tries < 4; tries++) {
    const ok = pickTreeAwareTarget(
      s.position.x, s.position.y, s.position.z,
      playerX, playerY, playerZ,
      s.surfaceNormal,
      def.hop_distance_min, def.hop_distance_max,
      _posScratch, _normalScratch,
    );
    if (isTooCrowded(_posScratch.x, _posScratch.z, s, deps.others)) continue;
    // Reject hop landings inside the FSZ so shpiders bounce off
    // the fortress's invisible wall like every other enemy type.
    if (isPointInFSZ(_posScratch.x, 0, _posScratch.z)) continue;
    endX = _posScratch.x;
    endY = _posScratch.y;
    endZ = _posScratch.z;
    endNX = _normalScratch.x;
    endNY = _normalScratch.y;
    endNZ = _normalScratch.z;
    accepted = ok;
    break;
  }

  // Fallback chain: if no tree-aware surface was returned, snap the
  // Y-coord to either a block top OR the world floor (y=0) so we
  // never end up hopping into mid-air.
  if (!accepted) {
    const groundY = findGroundY(endX, endY + 4, endZ, 64);
    endY = groundY === -Infinity ? 0 : groundY;
    endNX = 0; endNY = 1; endNZ = 0;
  }
  // Final safety net: if every retry landed inside the FSZ and we
  // fell through here, cancel the hop entirely by anchoring it to
  // the shpider's current position. Better than punching into the
  // safe zone.
  if (isPointInFSZ(endX, 0, endZ)) {
    endX = s.position.x;
    endY = s.position.y;
    endZ = s.position.z;
    endNX = s.surfaceNormal.x;
    endNY = s.surfaceNormal.y;
    endNZ = s.surfaceNormal.z;
  }

  const dx = endX - s.position.x;
  const dy = endY - s.position.y;
  const dz = endZ - s.position.z;
  const dist = Math.hypot(dx, dy, dz);

  s.hop.phase = 'hopping';
  s.hop.hopStartAt = now;
  s.hop.hopDurationMs = def.hop_duration_ms;
  s.hop.startX = s.position.x;
  s.hop.startY = s.position.y;
  s.hop.startZ = s.position.z;
  s.hop.endX = endX;
  s.hop.endY = endY;
  s.hop.endZ = endZ;
  s.hop.arcHeight = dist * def.hop_arc_factor;
  s.hop.endNormalX = endNX;
  s.hop.endNormalY = endNY;
  s.hop.endNormalZ = endNZ;

  if (dx !== 0 || dz !== 0) s.rotation = Math.atan2(dx, dz);

  // Play the per-tier hop sound through spatial audio so distant
  // shpiders sound distant. Volume falloff handled by the shared module.
  playHopSound(
    def.hop_sound_url,
    s.position.x, s.position.y, s.position.z,
    playerX, playerY, playerZ,
  );
}

/** Returns hop progress 0..1 if hopping, or null. */
export function getHopProgress(s: ShpiderInstance, now: number): number | null {
  if (s.hop.phase !== 'hopping') return null;
  return Math.min(1, (now - s.hop.hopStartAt) / s.hop.hopDurationMs);
}

/** Returns crawl progress 0..1 if crawling, or null. */
export function getCrawlProgress(s: ShpiderInstance, now: number): number | null {
  if (s.hop.phase !== 'crawling') return null;
  return Math.min(1, (now - s.hop.crawlStartAt) / s.hop.crawlDurationMs);
}
