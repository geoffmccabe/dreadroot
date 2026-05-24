// Death-explosion fragments.
//
// When a shpider dies we replace it with 26 independent fragments
// (body, head, 24 leg segments). Each fragment has its own velocity,
// rotation, and angular velocity, and integrates gravity + voxel
// collisions until it comes to rest or its lifetime expires.
//
// Rendering re-uses the existing per-tier InstancedMesh so dead
// fragments visually match the living shpider they came from —
// the renderer's frame loop just bumps the per-tier counters with
// fragment matrices after living-shpider matrices.

import * as THREE from 'three';
import type { ShpiderInstance } from '../types';
import { LEGS_PER_SHPIDER, SEGMENTS_PER_LEG, LEG_SEGMENT_THICKNESS } from '../constants';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

export type DeathFragmentType = 'body' | 'head' | 'leg';

export interface DeathFragment {
  type: DeathFragmentType;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  angularEulerVel: THREE.Vector3; // rad/s per axis
  scale: THREE.Vector3;
  shpiderTier: number;
  spawnedAt: number;
  lifetimeMs: number;
  bounces: number;
  isResting: boolean;
}

// Tuning ─────────────────────────────────────────────────────────────
const HORIZONTAL_SPEED_MIN = 8;   // m/s
const HORIZONTAL_SPEED_MAX = 22;
const VERTICAL_SPEED_MIN   = 5;   // m/s
const VERTICAL_SPEED_MAX   = 14;
const ANGULAR_VEL_RANGE    = 12;  // rad/s per axis
const GRAVITY              = 18;  // m/s² downward
const BOUNCE_ELASTICITY    = 0.45;
const REST_VEL_THRESHOLD   = 0.4; // m/s
const MIN_BOUNCES_BEFORE_REST = 1;
const LIFETIME_MS          = 12000;
const WORLD_FLOOR_Y        = 0;
const MAX_FRAGMENTS        = 800;

function randomUnitDirection(out: THREE.Vector3) {
  // Uniform random direction on the upper hemisphere (bias upward).
  const yaw = Math.random() * Math.PI * 2;
  const pitch = Math.random() * Math.PI * 0.45; // 0..0.45π = mostly above horizon
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  out.set(cp * cy, sp, cp * sy);
}

const _scratchDir = new THREE.Vector3();

/**
 * Build 26 fragments from a freshly-killed shpider. Each fragment is
 * positioned at its visual rest location in world space, then given a
 * random outward velocity scaled so it travels ~5–30 m before
 * gravity and bounces bring it to rest.
 */
export function createDeathFragments(s: ShpiderInstance, now: number): DeathFragment[] {
  const out: DeathFragment[] = [];
  const def = s.definition;
  const bodySize = def.body_size * s.scale;
  const headSize = def.head_size * s.scale;
  const halfBody = bodySize * 0.5;

  // Body center.
  const bodyCenter = new THREE.Vector3(s.position.x, s.position.y + halfBody, s.position.z);

  // === Body fragment ===
  {
    randomUnitDirection(_scratchDir);
    const hSpeed = HORIZONTAL_SPEED_MIN + Math.random() * (HORIZONTAL_SPEED_MAX - HORIZONTAL_SPEED_MIN);
    const vSpeed = VERTICAL_SPEED_MIN + Math.random() * (VERTICAL_SPEED_MAX - VERTICAL_SPEED_MIN);
    out.push({
      type: 'body',
      position: bodyCenter.clone(),
      velocity: new THREE.Vector3(_scratchDir.x * hSpeed, vSpeed, _scratchDir.z * hSpeed),
      rotation: new THREE.Quaternion(),
      angularEulerVel: new THREE.Vector3(
        (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
        (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
        (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
      ),
      scale: new THREE.Vector3(bodySize, bodySize, bodySize),
      shpiderTier: def.tier,
      spawnedAt: now,
      lifetimeMs: LIFETIME_MS,
      bounces: 0,
      isResting: false,
    });
  }

  // === Head fragment ===
  {
    randomUnitDirection(_scratchDir);
    const hSpeed = HORIZONTAL_SPEED_MIN + Math.random() * (HORIZONTAL_SPEED_MAX - HORIZONTAL_SPEED_MIN);
    const vSpeed = VERTICAL_SPEED_MIN + Math.random() * (VERTICAL_SPEED_MAX - VERTICAL_SPEED_MIN);
    out.push({
      type: 'head',
      position: new THREE.Vector3(
        s.position.x,
        s.position.y + bodySize + headSize * 0.5,
        s.position.z,
      ),
      velocity: new THREE.Vector3(_scratchDir.x * hSpeed, vSpeed, _scratchDir.z * hSpeed),
      rotation: new THREE.Quaternion(),
      angularEulerVel: new THREE.Vector3(
        (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
        (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
        (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
      ),
      scale: new THREE.Vector3(headSize, headSize, headSize),
      shpiderTier: def.tier,
      spawnedAt: now,
      lifetimeMs: LIFETIME_MS,
      bounces: 0,
      isResting: false,
    });
  }

  // === 24 leg segments ===
  // Place each segment near its resting position around the body
  // (no AI animation — just the rest pose at the moment of death)
  // and give it its own velocity. Leg segments are skinny boxes so
  // their world scale uses the segment's actual length and thickness.
  for (let leg = 0; leg < LEGS_PER_SHPIDER; leg++) {
    for (let seg = 0; seg < SEGMENTS_PER_LEG; seg++) {
      const a = (leg / LEGS_PER_SHPIDER) * Math.PI * 2 + 0.1;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const half = bodySize * 0.5;
      // Approximate segment midpoint (in body-local then world).
      let mx: number, my: number, mz: number;
      let length: number;
      if (seg === 0) {
        mx = cosA * half * 1.3;
        my = -half * 0.15;
        mz = sinA * half * 1.3;
        length = halfBody * 0.7;
      } else if (seg === 1) {
        mx = cosA * half * 1.8;
        my = -half * 0.5;
        mz = sinA * half * 1.8;
        length = halfBody * 0.7;
      } else {
        mx = cosA * half * 2.05;
        my = -half * 0.85;
        mz = sinA * half * 2.05;
        length = halfBody * 0.5;
      }
      // Rotate XZ by shpider yaw.
      const cosR = Math.cos(s.rotation);
      const sinR = Math.sin(s.rotation);
      const worldX = s.position.x + (mx * cosR + mz * sinR);
      const worldY = s.position.y + halfBody + my;
      const worldZ = s.position.z + (-mx * sinR + mz * cosR);

      randomUnitDirection(_scratchDir);
      const hSpeed = HORIZONTAL_SPEED_MIN + Math.random() * (HORIZONTAL_SPEED_MAX - HORIZONTAL_SPEED_MIN);
      const vSpeed = VERTICAL_SPEED_MIN + Math.random() * (VERTICAL_SPEED_MAX - VERTICAL_SPEED_MIN);

      out.push({
        type: 'leg',
        position: new THREE.Vector3(worldX, worldY, worldZ),
        velocity: new THREE.Vector3(_scratchDir.x * hSpeed, vSpeed, _scratchDir.z * hSpeed),
        rotation: new THREE.Quaternion(),
        angularEulerVel: new THREE.Vector3(
          (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
          (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
          (Math.random() - 0.5) * 2 * ANGULAR_VEL_RANGE,
        ),
        scale: new THREE.Vector3(LEG_SEGMENT_THICKNESS, length, LEG_SEGMENT_THICKNESS),
        shpiderTier: def.tier,
        spawnedAt: now,
        lifetimeMs: LIFETIME_MS,
        bounces: 0,
        isResting: false,
      });
    }
  }

  return out;
}

const _eulerScratch = new THREE.Euler();
const _quatScratch = new THREE.Quaternion();

/**
 * Advance every fragment one frame: gravity → swept-axis voxel
 * collision (bounce off solid blocks AND the y=0 world floor) →
 * tumble rotation. Returns the new fragment array with dead/expired
 * fragments filtered out so the caller can do a single setState.
 */
export function stepDeathFragments(
  fragments: DeathFragment[],
  dt: number,
  now: number,
): DeathFragment[] {
  const kept: DeathFragment[] = [];

  for (const f of fragments) {
    // Expired?
    if (now - f.spawnedAt > f.lifetimeMs) continue;

    if (!f.isResting) {
      // Gravity.
      f.velocity.y -= GRAVITY * dt;

      // Try-then-test each axis independently for cheap voxel bouncing.
      const px = f.position.x;
      const py = f.position.y;
      const pz = f.position.z;
      const nx = px + f.velocity.x * dt;
      const ny = py + f.velocity.y * dt;
      const nz = pz + f.velocity.z * dt;

      // X axis.
      if (worldCollisionGrid.hasVoxel(Math.floor(nx), Math.floor(py), Math.floor(pz))) {
        f.velocity.x = -f.velocity.x * BOUNCE_ELASTICITY;
        f.bounces++;
      } else {
        f.position.x = nx;
      }
      // Z axis.
      if (worldCollisionGrid.hasVoxel(Math.floor(f.position.x), Math.floor(py), Math.floor(nz))) {
        f.velocity.z = -f.velocity.z * BOUNCE_ELASTICITY;
        f.bounces++;
      } else {
        f.position.z = nz;
      }
      // Y axis — also handle the world floor at y=0.
      let yHit = false;
      if (worldCollisionGrid.hasVoxel(Math.floor(f.position.x), Math.floor(ny), Math.floor(f.position.z))) {
        yHit = true;
      } else if (ny < WORLD_FLOOR_Y) {
        yHit = true;
      }
      if (yHit) {
        f.velocity.y = -f.velocity.y * BOUNCE_ELASTICITY;
        f.position.y = Math.max(WORLD_FLOOR_Y, py);
        // Apply ground friction on horizontal velocity each bounce.
        f.velocity.x *= 0.85;
        f.velocity.z *= 0.85;
        f.bounces++;
      } else {
        f.position.y = ny;
      }

      // Rest condition: low velocity + at least one bounce.
      const vMagSq = f.velocity.x * f.velocity.x + f.velocity.y * f.velocity.y + f.velocity.z * f.velocity.z;
      if (vMagSq < REST_VEL_THRESHOLD * REST_VEL_THRESHOLD && f.bounces > MIN_BOUNCES_BEFORE_REST) {
        f.isResting = true;
        f.velocity.set(0, 0, 0);
        f.angularEulerVel.set(0, 0, 0);
      } else {
        // Tumble (only while in flight).
        _eulerScratch.set(
          f.angularEulerVel.x * dt,
          f.angularEulerVel.y * dt,
          f.angularEulerVel.z * dt,
        );
        _quatScratch.setFromEuler(_eulerScratch);
        f.rotation.multiplyQuaternions(_quatScratch, f.rotation);
      }
    }

    kept.push(f);
  }
  return kept;
}

export const DEATH_FRAGMENT_MAX = MAX_FRAGMENTS;
