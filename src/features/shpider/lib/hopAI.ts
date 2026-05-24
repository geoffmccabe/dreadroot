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
import { findGroundY, pickTreeAwareTarget } from './surfaceDetect';
import { SHPIDER_MIN_TARGET_SPACING } from '../constants';
import { playSpatialSound } from '@/lib/spatialAudio';

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
  void playSpatialSound(finalUrl, dist, { baseVolume: HOP_BASE_VOLUME });
}

interface StepDeps {
  playerX: number;
  playerY: number;
  playerZ: number;
  now: number;
  dt: number; // seconds since last frame
  /** Active shpider list (for anti-overlap target rejection). */
  others?: readonly ShpiderInstance[];
}

/** True if the candidate (x,z) is too close to another active shpider. */
function isTooCrowded(
  x: number, z: number, self: ShpiderInstance,
  others?: readonly ShpiderInstance[],
): boolean {
  if (!others) return false;
  const r2 = SHPIDER_MIN_TARGET_SPACING * SHPIDER_MIN_TARGET_SPACING;
  for (const o of others) {
    if (o === self || !o.isActive) continue;
    const dx = o.position.x - x;
    const dz = o.position.z - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
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

/**
 * Advance one shpider for the current frame. Mutates instance fields.
 */
export function stepShpiderHopAI(s: ShpiderInstance, deps: StepDeps): void {
  const { now, dt, playerX, playerY, playerZ } = deps;
  const def = s.definition;

  // ── Knockback decay. Bullet hits set s.velocity; here we integrate
  //    it onto the position and decay over time (halflife ~0.25s).
  if (s.velocity.x !== 0 || s.velocity.z !== 0) {
    s.position.x += s.velocity.x * dt;
    s.position.z += s.velocity.z * dt;
    const decay = Math.pow(0.5, dt * 4); // halflife = 0.25s
    s.velocity.x *= decay;
    s.velocity.z *= decay;
    if (Math.abs(s.velocity.x) < 0.05) s.velocity.x = 0;
    if (Math.abs(s.velocity.z) < 0.05) s.velocity.z = 0;
  }

  // ── Gravity guard. After hops, shpiders may end up suspended in
  //    mid-air. While idle/crawling, run them down until they hit
  //    either a block top OR the world floor (y = 0).
  if ((s.hop.phase === 'idle' || s.hop.phase === 'crawling')
      && s.surfaceNormal.y > 0.9) {
    const probedGround = findGroundY(s.position.x, s.position.y + 0.5, s.position.z, 64);
    const supportY = probedGround === -Infinity ? WORLD_FLOOR_Y : probedGround;
    if (s.position.y - supportY > 0.05) {
      s.velocity.y -= FALL_GRAVITY * dt;
      s.position.y += s.velocity.y * dt;
      if (s.position.y <= supportY) {
        s.position.y = supportY;
        s.velocity.y = 0;
      }
      return;
    }
    // On a support — clear any residual fall velocity.
    if (s.velocity.y !== 0) s.velocity.y = 0;
  }

  // ── IDLE: pick a target and decide whether to crawl or hop.
  if (s.hop.phase === 'idle') {
    if (now < s.hop.nextHopAt) return;

    // 60% of the time, do a short stalking crawl first; 40% pounce
    // straight away. Randomness so groups don't move in lock-step.
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

      // Anti-overlap: if the crawl destination would land on another
      // shpider, shorten it until it doesn't. Up to 4 retries.
      let retries = 4;
      while (retries-- > 0 && isTooCrowded(endX, endZ, s, deps.others)) {
        endX = (endX + s.position.x) * 0.5;
        endZ = (endZ + s.position.z) * 0.5;
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
    return;
  }

  // ── CRAWLING: slow linear lerp along tangent plane.
  if (s.hop.phase === 'crawling') {
    const t = Math.min(1, (now - s.hop.crawlStartAt) / s.hop.crawlDurationMs);
    s.position.x = s.hop.crawlStartX + (s.hop.crawlEndX - s.hop.crawlStartX) * t;
    s.position.z = s.hop.crawlStartZ + (s.hop.crawlEndZ - s.hop.crawlStartZ) * t;
    if (t >= 1) {
      // Crawl done → pounce immediately.
      launchHop(s, deps);
    }
    return;
  }

  // ── HOPPING: parabolic arc.
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
    s.hop.phase = 'idle';
    s.hop.nextHopAt = now + def.hop_interval_min_ms
                    + Math.random() * (def.hop_interval_max_ms - def.hop_interval_min_ms);
    s.velocity.set(0, 0, 0);
  }
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
