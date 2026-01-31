/**
 * ShtickmanAdapter - Bridges Shtickman instances to the universal AI system
 */

import * as THREE from 'three';
import type { ShtickmanInstance } from '@/features/shtickman/types';
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
import { isPointInFSZ, clampPositionOutsideFSZ } from '../fortressSafeZone';
import { SHTICKMAN_GRAVITY, KNOCKBACK_DECAY_RATE } from '@/features/shtickman/constants';

// Module-level locomotion context
let locomotionContext: {
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
} | null = null;

// Scratch vectors for direction calculations
const _direction = new THREE.Vector3();
const _knockbackDir = new THREE.Vector3();

/**
 * Set locomotion context for shtickman movement execution.
 */
export function setShtickmanLocomotionContext(ctx: typeof locomotionContext): void {
  locomotionContext = ctx;
}

/**
 * Extended shtickman instance with AI state
 */
export interface ShtickmanWithAI extends ShtickmanInstance {
  _aiLastTick?: number;
  lastAttackAt?: number;
}

/**
 * Adapter for Shtickman enemies
 */
export const ShtickmanAdapter: EnemyAdapter<ShtickmanWithAI> = {
  getId(shtickman: ShtickmanWithAI): string {
    return shtickman.id;
  },

  getType(): string {
    return 'shtickman';
  },

  getPosition(shtickman: ShtickmanWithAI): { x: number; y: number; z: number } {
    return {
      x: shtickman.position.x,
      y: shtickman.position.y,
      z: shtickman.position.z,
    };
  },

  buildContext(
    shtickman: ShtickmanWithAI,
    shared: SharedContext,
    state: BehaviorState
  ): BehaviorContext {
    const ex = shtickman.position.x;
    const ey = shtickman.position.y;
    const ez = shtickman.position.z;

    const dx = shared.playerX - ex;
    const dy = shared.playerY - ey;
    const dz = shared.playerZ - ez;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const now = performance.now();
    const defConfig = shtickman.definition.ai_config;

    const detectionRange = defConfig?.detectionRange ?? 50;
    const attackRange = defConfig?.attackRange ?? 2.0;
    const attackCooldownMs = defConfig?.attackCooldownMs ?? 1500;

    // Player inside FSZ = invisible to enemies
    const playerInFSZ = isPointInFSZ(shared.playerX, shared.playerY, shared.playerZ);

    return {
      entityId: shtickman.id,
      entityType: 'shtickman',

      ex, ey, ez,
      px: shared.playerX,
      py: shared.playerY,
      pz: shared.playerZ,

      distToPlayer,
      hasLineOfSight: !playerInFSZ,

      health: shtickman.currentHealth,
      maxHealth: shtickman.maxHealth,

      msSinceLastAttack: shtickman.lastAttackAt ? now - shtickman.lastAttackAt : 999999,
      msSinceLastDamaged: shtickman.lastDamagedAt ? now - shtickman.lastDamagedAt : 999999,

      nearbyAllies: 0,
      nearbyEnemies: 0,

      custom: {
        tier: shtickman.tier,
        detectionRange,
        attackRange,
        attackCooldownMs,
        damage: shtickman.definition.damage_per_hit,
        knockback: shtickman.definition.knockback_received,
        speed: shtickman.definition.speed,
      },

      state,
    };
  },

  applyResult(
    shtickman: ShtickmanWithAI,
    result: BehaviorResult,
    deltaMs: number,
    _shared?: SharedContext
  ): void {
    if (!EnemyManager.isAIControlled()) return;

    const deltaSeconds = deltaMs / 1000;

    // Apply gravity
    shtickman.velocity.y -= SHTICKMAN_GRAVITY * deltaSeconds;

    // Apply velocity (knockback + gravity)
    shtickman.position.x += shtickman.velocity.x * deltaSeconds;
    shtickman.position.y += shtickman.velocity.y * deltaSeconds;
    shtickman.position.z += shtickman.velocity.z * deltaSeconds;

    // Ground clamp
    if (shtickman.position.y < 0) {
      shtickman.position.y = 0;
      shtickman.velocity.y = 0;
    }

    // Decay horizontal velocity (knockback)
    const decay = Math.exp(-KNOCKBACK_DECAY_RATE * deltaSeconds);
    shtickman.velocity.x *= decay;
    shtickman.velocity.z *= decay;

    if (result.kind === 'idle') {
      return;
    }

    if (result.kind === 'move') {
      _direction.set(
        result.tx - shtickman.position.x,
        0,
        result.tz - shtickman.position.z
      );

      const dist = _direction.length();
      if (dist > 0.1) {
        _direction.normalize();

        const speed = shtickman.definition.speed * (result.speedMultiplier ?? 1);
        const moveAmount = Math.min(speed * deltaSeconds, dist);

        shtickman.position.x += _direction.x * moveAmount;
        shtickman.position.z += _direction.z * moveAmount;

        // Face movement direction
        shtickman.rotationY = Math.atan2(_direction.x, _direction.z);
      }
    }

    // Clamp to FSZ boundary (after both knockback and move)
    const clamped = clampPositionOutsideFSZ(shtickman.position.x, shtickman.position.z);
    shtickman.position.x = clamped.x;
    shtickman.position.z = clamped.z;

    if (result.kind === 'attack') {
      shtickman.lastAttackAt = performance.now();

      if (locomotionContext?.onPlayerHit) {
        _knockbackDir.set(result.dirX, 0, result.dirZ).normalize();
        locomotionContext.onPlayerHit(result.damage, result.knockback, _knockbackDir);
      }
    }
  },

  getBehaviors(shtickman: ShtickmanWithAI): BehaviorModule[] {
    const behaviors = shtickman.definition.ai_config?.behaviors ?? ['wander', 'chase', 'attack'];
    return getBehaviorsByIds(behaviors);
  },
};
