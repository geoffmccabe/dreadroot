/**
 * VortaxAdapter - Bridges Vortax instances to the universal AI system.
 * Cloned from ShroomerAdapter (same AI/pathfinding/movement/knockback). Only
 * getType() and the instance type differ — and the Vortax has NO fragmentation
 * explosion (sphere-cloud bodies don't explode into parts).
 */

import * as THREE from 'three';
import type { VortaxInstance } from '@/features/vortax/types';
import { VORTAX_BODY_PARTS } from '@/features/vortax/types';
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
  VORTAX_GRAVITY,
  KNOCKDOWN_TOTAL_DURATION_MS,
  KNOCKDOWN_TILT_DURATION_MS,
  KNOCKDOWN_SLIDE_DURATION_MS,
  VORTAX_SEPARATION_RADIUS,
  VORTAX_SEPARATION_FORCE,
  VORTAX_LANE_HALF_WIDTH,
  VORTAX_LANE_BREAK_DISTANCE,
  VORTAX_HITBOX_RADIUS,
} from '@/features/vortax/constants';
import { isPointInFSZ, clampPositionOutsideFSZ } from '../fortressSafeZone';

// Module-level locomotion context
let locomotionContext: {
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
} | null = null;

// Scratch vectors
const _direction = new THREE.Vector3();
const _knockbackDir = new THREE.Vector3();

/**
 * Set locomotion context for vortax movement execution.
 */
export function setVortaxLocomotionContext(ctx: typeof locomotionContext): void {
  locomotionContext = ctx;
}

/**
 * Extended vortax instance with AI state
 */
export interface VortaxWithAI extends VortaxInstance {
  _aiLastTick?: number;
  _laneOffset?: number;
}

/**
 * Adapter for Vortax enemies
 */
export const VortaxAdapter: EnemyAdapter<VortaxWithAI> = {
  getId(vortax: VortaxWithAI): string {
    return vortax.id;
  },

  getType(): string {
    return 'vortax';
  },

  getPosition(vortax: VortaxWithAI): { x: number; y: number; z: number } {
    return {
      x: vortax.position.x,
      y: vortax.position.y,
      z: vortax.position.z,
    };
  },

  getMass(vortax: VortaxWithAI): number {
    return massFromBoxVolumes(VORTAX_BODY_PARTS, vortax.scale ?? 1);
  },

  getRadius(vortax: VortaxWithAI): number {
    return VORTAX_HITBOX_RADIUS * (vortax.scale ?? 1);
  },

  isAirborne(vortax: VortaxWithAI): boolean {
    return vortax.position.y > 0.5;
  },

  buildContext(
    vortax: VortaxWithAI,
    shared: SharedContext,
    state: BehaviorState
  ): BehaviorContext {
    const ex = vortax.position.x;
    const ey = vortax.position.y;
    const ez = vortax.position.z;

    const dx = shared.playerX - ex;
    const dy = shared.playerY - ey;
    const dz = shared.playerZ - ez;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const now = performance.now();
    const defConfig = vortax.definition.ai_config;

    const detectionRange = defConfig?.detectionRange ?? 50;
    const attackRange = defConfig?.attackRange ?? 1.2;
    const attackCooldownMs = defConfig?.attackCooldownMs ?? 1000;

    return {
      entityId: vortax.id,
      entityType: 'vortax',

      ex, ey, ez,
      px: shared.playerX,
      py: shared.playerY,
      pz: shared.playerZ,

      distToPlayer,
      hasLineOfSight: !isPointInFSZ(shared.playerX, shared.playerY, shared.playerZ),

      health: vortax.currentHealth,
      maxHealth: vortax.maxHealth,

      msSinceLastAttack: vortax.lastAttackAt ? now - vortax.lastAttackAt : 999999,
      msSinceLastDamaged: vortax.lastDamagedAt ? now - vortax.lastDamagedAt : 999999,

      nearbyAllies: 0,
      nearbyEnemies: 0,

      custom: {
        tier: vortax.definition.tier,
        detectionRange,
        attackRange,
        attackCooldownMs,
        damage: vortax.definition.damage_per_hit,
        knockback: 3,
        speed: vortax.definition.speed,
      },

      state,
    };
  },

  applyResult(
    vortax: VortaxWithAI,
    result: BehaviorResult,
    deltaMs: number,
    shared?: SharedContext
  ): void {
    if (!EnemyManager.isAIControlled()) return;

    // Scattered by a grenade → pause (no move/attack) until the cloud regroups.
    if (vortax.regroupUntil && Date.now() < vortax.regroupUntil) return;

    const deltaSeconds = deltaMs / 1000;

    // Handle knockdown animation (3 phases: tilt, slide, recovery)
    if (vortax.isKnockedDown) {
      const now = Date.now();
      const elapsed = now - vortax.knockdownStartTime;
      const progress = Math.min(1, elapsed / KNOCKDOWN_TOTAL_DURATION_MS);
      vortax.knockdownProgress = progress;

      const slideEndTime = KNOCKDOWN_TILT_DURATION_MS + KNOCKDOWN_SLIDE_DURATION_MS;

      if (elapsed < slideEndTime && vortax.knockdownDirection) {
        const slideProgress = elapsed / slideEndTime;
        const totalSlideDistance = vortax.knockdownSlideDistance ?? 1;
        const slideSpeed = totalSlideDistance * (1 - slideProgress) * 3 * deltaSeconds;
        vortax.position.x += vortax.knockdownDirection.x * slideSpeed;
        vortax.position.z += vortax.knockdownDirection.z * slideSpeed;
      }

      if (progress >= 1) {
        vortax.isKnockedDown = false;
        vortax.knockdownProgress = 0;
      }

      const clamped = clampPositionOutsideFSZ(vortax.position.x, vortax.position.z);
      vortax.position.x = clamped.x;
      vortax.position.z = clamped.z;

      return;
    }

    const now = Date.now();
    const isStunned = vortax.stunUntil && now < vortax.stunUntil;

    // Apply gravity
    vortax.velocity.y -= VORTAX_GRAVITY * deltaSeconds;

    // Apply velocity (knockback + gravity)
    const oldY = vortax.position.y;
    vortax.position.x += vortax.velocity.x * deltaSeconds;
    vortax.position.y += vortax.velocity.y * deltaSeconds;
    vortax.position.z += vortax.velocity.z * deltaSeconds;

    // Landing
    let grounded = false;
    if (vortax.position.y < 0) {
      vortax.position.y = 0;
      vortax.velocity.y = 0;
    }
    if (!grounded && vortax.position.y <= 0.001) grounded = true;
    void oldY;
    void worldCollisionGrid;

    if (grounded) {
      const decay = Math.exp(-KNOCKBACK_DECAY_RATE * deltaSeconds);
      vortax.velocity.x *= decay;
      vortax.velocity.z *= decay;
    }

    if (isStunned) {
      const clamped = clampPositionOutsideFSZ(vortax.position.x, vortax.position.z);
      vortax.position.x = clamped.x;
      vortax.position.z = clamped.z;
      return;
    }

    if (result.kind === 'idle') {
      const clamped = clampPositionOutsideFSZ(vortax.position.x, vortax.position.z);
      vortax.position.x = clamped.x;
      vortax.position.z = clamped.z;
      return;
    }

    // Skip movement during emergence (first 3 seconds)
    const timeSinceSpawn = Date.now() - vortax.spawnedAt;
    const isEmerging = timeSinceSpawn < 3000;

    if (result.kind === 'move' && !isEmerging) {
      // ── Lane/row formation
      if (vortax._laneOffset === undefined) {
        let h = 0;
        for (let i = 0; i < vortax.id.length; i++) h = (h * 31 + vortax.id.charCodeAt(i)) | 0;
        const frac = ((h >>> 0) % 1000) / 1000;
        vortax._laneOffset = (frac - 0.5) * 2 * VORTAX_LANE_HALF_WIDTH;
      }

      const tdx = result.tx - vortax.position.x;
      const tdz = result.tz - vortax.position.z;
      const tdist = Math.sqrt(tdx * tdx + tdz * tdz);

      let aimX = result.tx;
      let aimZ = result.tz;
      if (tdist > VORTAX_LANE_BREAK_DISTANCE && tdist > 0.001) {
        const ndx = tdx / tdist, ndz = tdz / tdist;
        aimX = result.tx + (-ndz) * vortax._laneOffset;
        aimZ = result.tz + (ndx) * vortax._laneOffset;
      }

      _direction.set(aimX - vortax.position.x, 0, aimZ - vortax.position.z);
      const dist = _direction.length();
      if (dist > 0.1) {
        _direction.normalize();

        const speed = vortax.definition.speed * (result.speedMultiplier ?? 1);
        const moveAmount = speed * deltaSeconds;
        const actualMove = Math.min(moveAmount, dist);

        vortax.position.x += _direction.x * actualMove;
        vortax.position.z += _direction.z * actualMove;

        vortax.rotation = Math.atan2(_direction.x, _direction.z);
      }

      // ── Local separation
      const neighbors = EnemyManager.getSpatialIndex().getNearby(
        vortax.position.x, vortax.position.z, VORTAX_SEPARATION_RADIUS,
      );
      let sepX = 0, sepZ = 0;
      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        if (n.id === vortax.id || n.type !== 'vortax') continue;
        const ddx = vortax.position.x - n.x;
        const ddz = vortax.position.z - n.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > 0.0001 && d2 < VORTAX_SEPARATION_RADIUS * VORTAX_SEPARATION_RADIUS) {
          const d = Math.sqrt(d2);
          const strength = (VORTAX_SEPARATION_RADIUS - d) / VORTAX_SEPARATION_RADIUS;
          sepX += (ddx / d) * strength;
          sepZ += (ddz / d) * strength;
        }
      }
      if (sepX !== 0 || sepZ !== 0) {
        vortax.position.x += sepX * VORTAX_SEPARATION_FORCE * deltaSeconds;
        vortax.position.z += sepZ * VORTAX_SEPARATION_FORCE * deltaSeconds;
      }
    }

    const clamped = clampPositionOutsideFSZ(vortax.position.x, vortax.position.z);
    vortax.position.x = clamped.x;
    vortax.position.z = clamped.z;

    if (result.kind === 'attack') {
      vortax.lastAttackAt = performance.now();

      if (locomotionContext?.onPlayerHit) {
        _knockbackDir.set(result.dirX, 0, result.dirZ).normalize();
        locomotionContext.onPlayerHit(result.damage, result.knockback, _knockbackDir);
      }
    }

    void shared;
  },

  getBehaviors(vortax: VortaxWithAI): BehaviorModule[] {
    const behaviors = vortax.definition.ai_config?.behaviors ?? ['chase', 'attack'];
    return getBehaviorsByIds(behaviors);
  },
};
