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
import { findGroundY, pickTreeAwareTarget, findLandingSurface } from './surfaceDetect';

const _normalScratch = new THREE.Vector3();
const _posScratch = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _tangentA = new THREE.Vector3();
const _tangentB = new THREE.Vector3();

const CRAWL_SPEED = 1.5; // blocks/sec along surface tangent
const CRAWL_MIN_MS = 800;
const CRAWL_MAX_MS = 2400;
const FALL_GRAVITY = 18.0; // blocks/s² while in mid-air (no support)

interface StepDeps {
  playerX: number;
  playerY: number;
  playerZ: number;
  now: number;
  dt: number; // seconds since last frame (for crawl + fall integrations)
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

  // ── Free-fall guard. If we ended up above the ground with no
  //    support voxel beneath, integrate gravity until we hit something.
  if (s.hop.phase === 'idle' && s.surfaceNormal.y > 0.9) {
    const groundY = findGroundY(s.position.x, s.position.y, s.position.z, 32);
    if (groundY === -Infinity) {
      // No support found in 32 voxels — let it sit. (Edge: bottomless world.)
    } else if (s.position.y - groundY > 0.05) {
      // Falling.
      s.velocity.y -= FALL_GRAVITY * dt;
      s.position.y += s.velocity.y * dt;
      if (s.position.y <= groundY) {
        s.position.y = groundY;
        s.velocity.y = 0;
      }
      return;
    }
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
      const endX = s.position.x + (_tangentA.x * dirA + _tangentB.x * dirB) * distance;
      const endZ = s.position.z + (_tangentA.z * dirA + _tangentB.z * dirB) * distance;

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

  const accepted = pickTreeAwareTarget(
    s.position.x, s.position.y, s.position.z,
    playerX, playerY, playerZ,
    s.surfaceNormal,
    def.hop_distance_min, def.hop_distance_max,
    _posScratch, _normalScratch,
  );

  // If target is rejected (inside block / no surface), the fallback in
  // pickTreeAwareTarget gives us a flat-ground hop on the current surface.
  let endX = _posScratch.x;
  let endY = _posScratch.y;
  let endZ = _posScratch.z;
  let endNX = _normalScratch.x;
  let endNY = _normalScratch.y;
  let endNZ = _normalScratch.z;

  if (!accepted) {
    // Re-find the surface below the fallback target so we don't fly
    // off the ground into the void.
    const groundY = findGroundY(endX, endY + 4, endZ, 32);
    if (groundY > -1000) endY = groundY;
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
