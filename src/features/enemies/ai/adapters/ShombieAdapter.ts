/**
 * ShombieAdapter - Bridges Shombie instances to the universal AI system
 */

import * as THREE from 'three';
import type { ShombieInstance } from '@/features/shombie/types';
import { SHOMBIE_BODY_PARTS } from '@/features/shombie/types';
import type {
  EnemyAdapter,
  BehaviorContext,
  BehaviorResult,
  SharedContext,
  BehaviorState,
  BehaviorModule,
} from '../types';
import { getBehaviorsByIds } from '../behaviors';
import { DEFAULT_AI_CONFIG } from '../types';
import { EnemyManager } from '../EnemyManager';
import { massFromBoxVolumes } from '../enemyMass';
import {
  KNOCKBACK_DECAY_RATE,
  SHOMBIE_GRAVITY,
  KNOCKDOWN_TOTAL_DURATION_MS,
  KNOCKDOWN_TILT_DURATION_MS,
  KNOCKDOWN_SLIDE_DURATION_MS,
  SHOMBIE_SEPARATION_RADIUS,
  SHOMBIE_SEPARATION_FORCE,
  SHOMBIE_LANE_HALF_WIDTH,
  SHOMBIE_LANE_BREAK_DISTANCE,
  SHOMBIE_HITBOX_RADIUS,
} from '@/features/shombie/constants';
import { isPointInFSZ, clampPositionOutsideFSZ } from '../fortressSafeZone';

// Module-level locomotion context
let locomotionContext: {
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
} | null = null;

// Scratch vector for direction calculations
const _direction = new THREE.Vector3();
const _knockbackDir = new THREE.Vector3();

/**
 * Set locomotion context for shombie movement execution.
 */
export function setShombieLocomotionContext(ctx: typeof locomotionContext): void {
  locomotionContext = ctx;
}

/**
 * Extended shombie instance with AI state
 */
export interface ShombieWithAI extends ShombieInstance {
  /** Managed by AI system */
  _aiLastTick?: number;
  /** Stable per-shombie lateral lane offset for row formation (computed once). */
  _laneOffset?: number;
}

/**
 * Adapter for Shombie enemies
 */
export const ShombieAdapter: EnemyAdapter<ShombieWithAI> = {
  getId(shombie: ShombieWithAI): string {
    return shombie.id;
  },
  
  getType(): string {
    return 'shombie';
  },
  
  getPosition(shombie: ShombieWithAI): { x: number; y: number; z: number } {
    return {
      x: shombie.position.x,
      y: shombie.position.y,
      z: shombie.position.z,
    };
  },

  // Physics: mass = summed box volume (same density), radius = hitbox radius.
  // Both scale with the instance's size. Pattern any enemy type copies — the
  // shared grid then handles its physics with no type-specific code.
  getMass(shombie: ShombieWithAI): number {
    return massFromBoxVolumes(SHOMBIE_BODY_PARTS, shombie.scale ?? 1);
  },

  getRadius(shombie: ShombieWithAI): number {
    return SHOMBIE_HITBOX_RADIUS * (shombie.scale ?? 1);
  },
  
  buildContext(
    shombie: ShombieWithAI, 
    shared: SharedContext,
    state: BehaviorState
  ): BehaviorContext {
    const ex = shombie.position.x;
    const ey = shombie.position.y;
    const ez = shombie.position.z;
    
    const dx = shared.playerX - ex;
    const dy = shared.playerY - ey;
    const dz = shared.playerZ - ez;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    const now = performance.now();
    const defConfig = shombie.definition.ai_config;
    
    const detectionRange = defConfig?.detectionRange ?? 50;
    const attackRange = defConfig?.attackRange ?? 1.2;
    const attackCooldownMs = defConfig?.attackCooldownMs ?? 1000;
    
    return {
      entityId: shombie.id,
      entityType: 'shombie',
      
      ex, ey, ez,
      px: shared.playerX,
      py: shared.playerY,
      pz: shared.playerZ,
      
      distToPlayer,
      hasLineOfSight: !isPointInFSZ(shared.playerX, shared.playerY, shared.playerZ),
      
      health: shombie.currentHealth,
      maxHealth: shombie.maxHealth,
      
      msSinceLastAttack: shombie.lastAttackAt ? now - shombie.lastAttackAt : 999999,
      msSinceLastDamaged: shombie.lastDamagedAt ? now - shombie.lastDamagedAt : 999999,
      
      nearbyAllies: 0,
      nearbyEnemies: 0,
      
      custom: {
        tier: shombie.definition.tier,
        detectionRange,
        attackRange,
        attackCooldownMs,
        damage: shombie.definition.damage_per_hit,
        knockback: 3, // Fixed knockback to player
        speed: shombie.definition.speed,
      },
      
      state,
    };
  },
  
  applyResult(
    shombie: ShombieWithAI,
    result: BehaviorResult,
    deltaMs: number,
    shared?: SharedContext
  ): void {
    if (!EnemyManager.isAIControlled()) return;

    const deltaSeconds = deltaMs / 1000;

    // Handle knockdown animation (3 phases: tilt, slide, recovery)
    if (shombie.isKnockedDown) {
      const now = Date.now();
      const elapsed = now - shombie.knockdownStartTime;
      const progress = Math.min(1, elapsed / KNOCKDOWN_TOTAL_DURATION_MS);
      shombie.knockdownProgress = progress;

      // Slide during phases 1 (tilt) and 2 (flat)
      const slideEndTime = KNOCKDOWN_TILT_DURATION_MS + KNOCKDOWN_SLIDE_DURATION_MS;

      if (elapsed < slideEndTime && shombie.knockdownDirection) {
        const slideProgress = elapsed / slideEndTime;
        // Use stored slide distance (1 block per player level, set in damageShombie)
        const totalSlideDistance = shombie.knockdownSlideDistance ?? 1;
        // Decelerate: more speed at start, less at end
        const slideSpeed = totalSlideDistance * (1 - slideProgress) * 3 * deltaSeconds;
        shombie.position.x += shombie.knockdownDirection.x * slideSpeed;
        shombie.position.z += shombie.knockdownDirection.z * slideSpeed;
      }

      // End knockdown when complete
      if (progress >= 1) {
        shombie.isKnockedDown = false;
        shombie.knockdownProgress = 0;
      }

      // Clamp to FSZ boundary after knockdown slide
      const clamped = clampPositionOutsideFSZ(shombie.position.x, shombie.position.z);
      shombie.position.x = clamped.x;
      shombie.position.z = clamped.z;

      // Skip normal movement when knocked down
      return;
    }

    // Check if stunned (body shot stun - can't move for 1 second)
    const now = Date.now();
    const isStunned = shombie.stunUntil && now < shombie.stunUntil;

    // Apply gravity
    shombie.velocity.y -= SHOMBIE_GRAVITY * deltaSeconds;

    // Apply velocity (knockback + gravity)
    shombie.position.x += shombie.velocity.x * deltaSeconds;
    shombie.position.y += shombie.velocity.y * deltaSeconds;
    shombie.position.z += shombie.velocity.z * deltaSeconds;

    // Ground clamp
    if (shombie.position.y < 0) {
      shombie.position.y = 0;
      shombie.velocity.y = 0;
    }

    // Decay horizontal velocity (knockback)
    const decay = Math.exp(-KNOCKBACK_DECAY_RATE * deltaSeconds);
    shombie.velocity.x *= decay;
    shombie.velocity.z *= decay;

    // If stunned, skip AI movement but apply FSZ clamp
    if (isStunned) {
      const clamped = clampPositionOutsideFSZ(shombie.position.x, shombie.position.z);
      shombie.position.x = clamped.x;
      shombie.position.z = clamped.z;
      return;
    }

    if (result.kind === 'idle') {
      // Clamp to FSZ boundary even when idle (knockback may push into zone)
      const clamped = clampPositionOutsideFSZ(shombie.position.x, shombie.position.z);
      shombie.position.x = clamped.x;
      shombie.position.z = clamped.z;
      return;
    }

    // Skip movement during emergence (first 3 seconds)
    const timeSinceSpawn = Date.now() - shombie.spawnedAt;
    const isEmerging = timeSinceSpawn < 3000;

    if (result.kind === 'move' && !isEmerging) {
      // ── Lane/row formation ──────────────────────────────────────────
      // Aim at a point offset sideways from the target (the player) by a
      // stable per-shombie amount, so the horde fans into parallel rows
      // instead of piling onto one point. Within BREAK_DISTANCE, drop the
      // lane and charge the target directly.
      if (shombie._laneOffset === undefined) {
        // Stable pseudo-random offset in [-HALF_WIDTH, +HALF_WIDTH] from id.
        let h = 0;
        for (let i = 0; i < shombie.id.length; i++) h = (h * 31 + shombie.id.charCodeAt(i)) | 0;
        const frac = ((h >>> 0) % 1000) / 1000; // 0..1
        shombie._laneOffset = (frac - 0.5) * 2 * SHOMBIE_LANE_HALF_WIDTH;
      }

      const tdx = result.tx - shombie.position.x;
      const tdz = result.tz - shombie.position.z;
      const tdist = Math.sqrt(tdx * tdx + tdz * tdz);

      let aimX = result.tx;
      let aimZ = result.tz;
      if (tdist > SHOMBIE_LANE_BREAK_DISTANCE && tdist > 0.001) {
        const ndx = tdx / tdist, ndz = tdz / tdist;
        // Perpendicular (left) of the approach direction.
        aimX = result.tx + (-ndz) * shombie._laneOffset;
        aimZ = result.tz + (ndx) * shombie._laneOffset;
      }

      // Direction to the (lane-adjusted) aim point.
      _direction.set(aimX - shombie.position.x, 0, aimZ - shombie.position.z);
      const dist = _direction.length();
      if (dist > 0.1) {
        _direction.normalize();

        // Shambling movement with speed multiplier
        const speed = shombie.definition.speed * (result.speedMultiplier ?? 1);
        const moveAmount = speed * deltaSeconds;

        // Don't overshoot
        const actualMove = Math.min(moveAmount, dist);

        shombie.position.x += _direction.x * actualMove;
        shombie.position.z += _direction.z * actualMove;

        // Face movement direction
        shombie.rotation = Math.atan2(_direction.x, _direction.z);
      }

      // ── Local separation ────────────────────────────────────────────
      // Push gently away from immediate neighbors so shombies don't overlap.
      // Queries the SHARED enemy spatial index (all types, type-tagged) and
      // keeps shombie-vs-shombie spacing — same grid the cross-entity
      // collision + AI use, and the future L2 DO's authoritative registry.
      const neighbors = EnemyManager.getSpatialIndex().getNearby(
        shombie.position.x, shombie.position.z, SHOMBIE_SEPARATION_RADIUS,
      );
      let sepX = 0, sepZ = 0;
      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        if (n.id === shombie.id || n.type !== 'shombie') continue;
        const ddx = shombie.position.x - n.x;
        const ddz = shombie.position.z - n.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > 0.0001 && d2 < SHOMBIE_SEPARATION_RADIUS * SHOMBIE_SEPARATION_RADIUS) {
          const d = Math.sqrt(d2);
          const strength = (SHOMBIE_SEPARATION_RADIUS - d) / SHOMBIE_SEPARATION_RADIUS; // 0..1
          sepX += (ddx / d) * strength;
          sepZ += (ddz / d) * strength;
        }
      }
      if (sepX !== 0 || sepZ !== 0) {
        shombie.position.x += sepX * SHOMBIE_SEPARATION_FORCE * deltaSeconds;
        shombie.position.z += sepZ * SHOMBIE_SEPARATION_FORCE * deltaSeconds;
      }
    }

    // Clamp to FSZ boundary after all movement (knockback + AI move)
    const clamped = clampPositionOutsideFSZ(shombie.position.x, shombie.position.z);
    shombie.position.x = clamped.x;
    shombie.position.z = clamped.z;

    if (result.kind === 'attack') {
      shombie.lastAttackAt = performance.now();

      // Apply damage to player
      if (locomotionContext?.onPlayerHit) {
        _knockbackDir.set(result.dirX, 0, result.dirZ).normalize();
        locomotionContext.onPlayerHit(result.damage, result.knockback, _knockbackDir);
      }
    }
  },
  
  getBehaviors(shombie: ShombieWithAI): BehaviorModule[] {
    const behaviors = shombie.definition.ai_config?.behaviors ?? ['chase', 'attack'];
    return getBehaviorsByIds(behaviors);
  },
};
