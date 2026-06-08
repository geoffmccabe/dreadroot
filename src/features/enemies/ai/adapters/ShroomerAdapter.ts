/**
 * ShroomerAdapter - Bridges Shroomer instances to the universal AI system.
 * Cloned verbatim from ShombieAdapter (same behaviors, mass, radius,
 * tumble/knockback/FSZ, applyResult). Only getType() and the operated-on
 * instance type differ.
 */

import * as THREE from 'three';
import type { ShroomerInstance } from '@/features/shroomer/types';
import { SHROOMER_BODY_PARTS } from '@/features/shroomer/types';
import type {
  EnemyAdapter,
  BehaviorContext,
  BehaviorResult,
  SharedContext,
  BehaviorState,
  BehaviorModule,
} from '../types';
import { getBehaviorsByIds } from '../behaviors';
import { EnemyManager } from '../EnemyManager';
import { massFromBoxVolumes } from '../enemyMass';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import {
  KNOCKBACK_DECAY_RATE,
  SHROOMER_GRAVITY,
  KNOCKDOWN_TOTAL_DURATION_MS,
  KNOCKDOWN_TILT_DURATION_MS,
  KNOCKDOWN_SLIDE_DURATION_MS,
  SHROOMER_SEPARATION_RADIUS,
  SHROOMER_SEPARATION_FORCE,
  SHROOMER_LANE_HALF_WIDTH,
  SHROOMER_LANE_BREAK_DISTANCE,
  SHROOMER_HITBOX_RADIUS,
  TUMBLE_WAIT_MS,
  TUMBLE_RECOVER_MS,
} from '@/features/shroomer/constants';
import { isPointInFSZ, clampPositionOutsideFSZ } from '../fortressSafeZone';

// Module-level locomotion context
let locomotionContext: {
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
} | null = null;

// Scratch vector for direction calculations
const _direction = new THREE.Vector3();
const _knockbackDir = new THREE.Vector3();

/**
 * Set locomotion context for shroomer movement execution.
 */
export function setShroomerLocomotionContext(ctx: typeof locomotionContext): void {
  locomotionContext = ctx;
}

/**
 * Extended shroomer instance with AI state
 */
export interface ShroomerWithAI extends ShroomerInstance {
  /** Managed by AI system */
  _aiLastTick?: number;
  /** Stable per-shroomer lateral lane offset for row formation (computed once). */
  _laneOffset?: number;
}

/**
 * Adapter for Shroomer enemies
 */
export const ShroomerAdapter: EnemyAdapter<ShroomerWithAI> = {
  getId(shroomer: ShroomerWithAI): string {
    return shroomer.id;
  },

  getType(): string {
    return 'shroomer';
  },

  getPosition(shroomer: ShroomerWithAI): { x: number; y: number; z: number } {
    return {
      x: shroomer.position.x,
      y: shroomer.position.y,
      z: shroomer.position.z,
    };
  },

  getMass(shroomer: ShroomerWithAI): number {
    return massFromBoxVolumes(SHROOMER_BODY_PARTS, shroomer.scale ?? 1);
  },

  getRadius(shroomer: ShroomerWithAI): number {
    return SHROOMER_HITBOX_RADIUS * (shroomer.scale ?? 1);
  },

  isAirborne(shroomer: ShroomerWithAI): boolean {
    return shroomer.position.y > 0.5 || !!shroomer.isTumbling;
  },

  buildContext(
    shroomer: ShroomerWithAI,
    shared: SharedContext,
    state: BehaviorState
  ): BehaviorContext {
    const ex = shroomer.position.x;
    const ey = shroomer.position.y;
    const ez = shroomer.position.z;

    const dx = shared.playerX - ex;
    const dy = shared.playerY - ey;
    const dz = shared.playerZ - ez;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const now = performance.now();
    const defConfig = shroomer.definition.ai_config;

    const detectionRange = defConfig?.detectionRange ?? 50;
    const attackRange = defConfig?.attackRange ?? 1.2;
    const attackCooldownMs = defConfig?.attackCooldownMs ?? 1000;

    return {
      entityId: shroomer.id,
      entityType: 'shroomer',

      ex, ey, ez,
      px: shared.playerX,
      py: shared.playerY,
      pz: shared.playerZ,

      distToPlayer,
      hasLineOfSight: !isPointInFSZ(shared.playerX, shared.playerY, shared.playerZ),

      health: shroomer.currentHealth,
      maxHealth: shroomer.maxHealth,

      msSinceLastAttack: shroomer.lastAttackAt ? now - shroomer.lastAttackAt : 999999,
      msSinceLastDamaged: shroomer.lastDamagedAt ? now - shroomer.lastDamagedAt : 999999,

      nearbyAllies: 0,
      nearbyEnemies: 0,

      custom: {
        tier: shroomer.definition.tier,
        detectionRange,
        attackRange,
        attackCooldownMs,
        damage: shroomer.definition.damage_per_hit,
        knockback: 3, // Fixed knockback to player
        speed: shroomer.definition.speed,
      },

      state,
    };
  },

  applyResult(
    shroomer: ShroomerWithAI,
    result: BehaviorResult,
    deltaMs: number,
    shared?: SharedContext
  ): void {
    if (!EnemyManager.isAIControlled()) return;

    // Exploding (headshot-kill fragmentation): the renderer drives the flying
    // parts from a fixed origin — freeze all AI/physics on the body.
    if (shroomer.isExploding) return;

    const deltaSeconds = deltaMs / 1000;

    // Handle knockdown animation (3 phases: tilt, slide, recovery)
    if (shroomer.isKnockedDown) {
      const now = Date.now();
      const elapsed = now - shroomer.knockdownStartTime;
      const progress = Math.min(1, elapsed / KNOCKDOWN_TOTAL_DURATION_MS);
      shroomer.knockdownProgress = progress;

      const slideEndTime = KNOCKDOWN_TILT_DURATION_MS + KNOCKDOWN_SLIDE_DURATION_MS;

      if (elapsed < slideEndTime && shroomer.knockdownDirection) {
        const slideProgress = elapsed / slideEndTime;
        const totalSlideDistance = shroomer.knockdownSlideDistance ?? 1;
        const slideSpeed = totalSlideDistance * (1 - slideProgress) * 3 * deltaSeconds;
        shroomer.position.x += shroomer.knockdownDirection.x * slideSpeed;
        shroomer.position.z += shroomer.knockdownDirection.z * slideSpeed;
      }

      if (progress >= 1) {
        shroomer.isKnockedDown = false;
        shroomer.knockdownProgress = 0;
      }

      const clamped = clampPositionOutsideFSZ(shroomer.position.x, shroomer.position.z);
      shroomer.position.x = clamped.x;
      shroomer.position.z = clamped.z;

      return;
    }

    const now = Date.now();
    const isStunned = shroomer.stunUntil && now < shroomer.stunUntil;

    // Apply gravity
    shroomer.velocity.y -= SHROOMER_GRAVITY * deltaSeconds;

    // Apply velocity (knockback + gravity)
    const oldY = shroomer.position.y;
    shroomer.position.x += shroomer.velocity.x * deltaSeconds;
    shroomer.position.y += shroomer.velocity.y * deltaSeconds;
    shroomer.position.z += shroomer.velocity.z * deltaSeconds;

    // Landing (block-aware for tumbling ragdolls)
    let grounded = false;
    if (shroomer.isTumbling && shroomer.velocity.y <= 0) {
      let surfaceY = 0;
      const n = worldCollisionGrid.getNearby(shroomer.position.x, shroomer.position.z, 1);
      const res = worldCollisionGrid.nearbyResult;
      for (let i = 0; i < n; i++) {
        const c = res[i] as THREE.Box3;
        if (!c || !c.max) continue;
        if (shroomer.position.x >= c.min.x && shroomer.position.x < c.max.x &&
            shroomer.position.z >= c.min.z && shroomer.position.z < c.max.z &&
            c.max.y <= oldY + 0.1 && c.max.y > surfaceY) {
          surfaceY = c.max.y;
        }
      }
      if (shroomer.position.y <= surfaceY) {
        shroomer.position.y = surfaceY;
        shroomer.velocity.y = 0;
        grounded = true;
      }
    } else if (shroomer.position.y < 0) {
      shroomer.position.y = 0;
      shroomer.velocity.y = 0;
    }
    if (!grounded && shroomer.position.y <= 0.001) grounded = true;

    if (grounded) {
      const decay = Math.exp(-KNOCKBACK_DECAY_RATE * deltaSeconds);
      shroomer.velocity.x *= decay;
      shroomer.velocity.z *= decay;
    }

    // ── Blast tumble: detect landing, then hold + recover.
    if (shroomer.isTumbling) {
      const tnow = Date.now();
      if (shroomer.tumbleLandedAt === 0 &&
          grounded &&
          tnow - (shroomer.tumbleLaunchAt ?? tnow) > 150) {
        shroomer.tumbleLandedAt = tnow;
      }
      const sinceLand = shroomer.tumbleLandedAt ? tnow - shroomer.tumbleLandedAt : -1;
      const done = sinceLand >= 0 && (shroomer.isCorpse
        ? sinceLand >= TUMBLE_WAIT_MS
        : sinceLand >= TUMBLE_WAIT_MS + TUMBLE_RECOVER_MS);
      if (done) {
        if (shroomer.isCorpse) {
          shroomer.isActive = false;
          return;
        }
        shroomer.isTumbling = false;
      } else {
        const clamped = clampPositionOutsideFSZ(shroomer.position.x, shroomer.position.z);
        shroomer.position.x = clamped.x;
        shroomer.position.z = clamped.z;
        return;
      }
    }

    if (isStunned) {
      const clamped = clampPositionOutsideFSZ(shroomer.position.x, shroomer.position.z);
      shroomer.position.x = clamped.x;
      shroomer.position.z = clamped.z;
      return;
    }

    if (result.kind === 'idle') {
      const clamped = clampPositionOutsideFSZ(shroomer.position.x, shroomer.position.z);
      shroomer.position.x = clamped.x;
      shroomer.position.z = clamped.z;
      return;
    }

    // Skip movement during emergence (first 3 seconds)
    const timeSinceSpawn = Date.now() - shroomer.spawnedAt;
    const isEmerging = timeSinceSpawn < 3000;

    if (result.kind === 'move' && !isEmerging) {
      // ── Lane/row formation
      if (shroomer._laneOffset === undefined) {
        let h = 0;
        for (let i = 0; i < shroomer.id.length; i++) h = (h * 31 + shroomer.id.charCodeAt(i)) | 0;
        const frac = ((h >>> 0) % 1000) / 1000;
        shroomer._laneOffset = (frac - 0.5) * 2 * SHROOMER_LANE_HALF_WIDTH;
      }

      const tdx = result.tx - shroomer.position.x;
      const tdz = result.tz - shroomer.position.z;
      const tdist = Math.sqrt(tdx * tdx + tdz * tdz);

      let aimX = result.tx;
      let aimZ = result.tz;
      if (tdist > SHROOMER_LANE_BREAK_DISTANCE && tdist > 0.001) {
        const ndx = tdx / tdist, ndz = tdz / tdist;
        aimX = result.tx + (-ndz) * shroomer._laneOffset;
        aimZ = result.tz + (ndx) * shroomer._laneOffset;
      }

      _direction.set(aimX - shroomer.position.x, 0, aimZ - shroomer.position.z);
      const dist = _direction.length();
      if (dist > 0.1) {
        _direction.normalize();

        const speed = shroomer.definition.speed * (result.speedMultiplier ?? 1);
        const moveAmount = speed * deltaSeconds;

        const actualMove = Math.min(moveAmount, dist);

        shroomer.position.x += _direction.x * actualMove;
        shroomer.position.z += _direction.z * actualMove;

        shroomer.rotation = Math.atan2(_direction.x, _direction.z);
      }

      // ── Local separation
      const neighbors = EnemyManager.getSpatialIndex().getNearby(
        shroomer.position.x, shroomer.position.z, SHROOMER_SEPARATION_RADIUS,
      );
      let sepX = 0, sepZ = 0;
      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        if (n.id === shroomer.id || n.type !== 'shroomer') continue;
        const ddx = shroomer.position.x - n.x;
        const ddz = shroomer.position.z - n.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > 0.0001 && d2 < SHROOMER_SEPARATION_RADIUS * SHROOMER_SEPARATION_RADIUS) {
          const d = Math.sqrt(d2);
          const strength = (SHROOMER_SEPARATION_RADIUS - d) / SHROOMER_SEPARATION_RADIUS;
          sepX += (ddx / d) * strength;
          sepZ += (ddz / d) * strength;
        }
      }
      if (sepX !== 0 || sepZ !== 0) {
        shroomer.position.x += sepX * SHROOMER_SEPARATION_FORCE * deltaSeconds;
        shroomer.position.z += sepZ * SHROOMER_SEPARATION_FORCE * deltaSeconds;
      }
    }

    const clamped = clampPositionOutsideFSZ(shroomer.position.x, shroomer.position.z);
    shroomer.position.x = clamped.x;
    shroomer.position.z = clamped.z;

    if (result.kind === 'attack') {
      shroomer.lastAttackAt = performance.now();

      if (locomotionContext?.onPlayerHit) {
        _knockbackDir.set(result.dirX, 0, result.dirZ).normalize();
        locomotionContext.onPlayerHit(result.damage, result.knockback, _knockbackDir);
      }
    }
  },

  getBehaviors(shroomer: ShroomerWithAI): BehaviorModule[] {
    const behaviors = shroomer.definition.ai_config?.behaviors ?? ['chase', 'attack'];
    return getBehaviorsByIds(behaviors);
  },
};
