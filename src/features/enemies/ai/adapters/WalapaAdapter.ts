/**
 * WalapaAdapter - Bridges Walapa instances to the universal AI system
 */

import * as THREE from 'three';
import type { WalapaInstance } from '@/features/walapa/types';
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
import { isPointInFSZ } from '../fortressSafeZone';

// Walapa base speed (blocks/second) — matches WALAPA_BASE_SPEED in walapa/constants.ts
const BASE_SPEED = 4.0;

// Module-level locomotion context
let locomotionContext: {
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
} | null = null;

// Scratch vector for direction calculations
const _direction = new THREE.Vector3();

/**
 * Set locomotion context for walapa movement execution.
 */
export function setWalapaLocomotionContext(ctx: typeof locomotionContext): void {
  locomotionContext = ctx;
}

/**
 * Extended walapa instance with AI state
 */
export interface WalapaWithAI extends WalapaInstance {
  _aiLastTick?: number;
  lastDamagedAt?: number;
  lastAttackAt?: number;
}

/**
 * Adapter for Walapa enemies
 */
export const WalapaAdapter: EnemyAdapter<WalapaWithAI> = {
  getId(walapa: WalapaWithAI): string {
    return walapa.id;
  },

  getType(): string {
    return 'walapa';
  },

  getPosition(walapa: WalapaWithAI): { x: number; y: number; z: number } {
    return {
      x: walapa.position.x,
      y: walapa.position.y,
      z: walapa.position.z,
    };
  },

  buildContext(
    walapa: WalapaWithAI,
    shared: SharedContext,
    state: BehaviorState
  ): BehaviorContext {
    const ex = walapa.position.x;
    const ey = walapa.position.y;
    const ez = walapa.position.z;

    const dx = shared.playerX - ex;
    const dy = shared.playerY - ey;
    const dz = shared.playerZ - ez;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const now = performance.now();
    const defConfig = walapa.definition.ai_config;

    const detectionRange = defConfig?.detectionRange ?? 50;
    const attackRange = defConfig?.attackRange ?? 3.0;
    const attackCooldownMs = defConfig?.attackCooldownMs ?? 2000;

    // Player inside FSZ = invisible to enemies
    const playerInFSZ = isPointInFSZ(shared.playerX, shared.playerY, shared.playerZ);

    return {
      entityId: walapa.id,
      entityType: 'walapa',

      ex, ey, ez,
      px: shared.playerX,
      py: shared.playerY,
      pz: shared.playerZ,

      distToPlayer,
      hasLineOfSight: !playerInFSZ,

      health: walapa.currentHealth,
      maxHealth: walapa.maxHealth,

      msSinceLastAttack: walapa.lastAttackAt ? now - walapa.lastAttackAt : 999999,
      msSinceLastDamaged: walapa.lastDamagedAt ? now - walapa.lastDamagedAt : 999999,

      nearbyAllies: 0,
      nearbyEnemies: 0,

      custom: {
        tier: walapa.definition.tier,
        detectionRange,
        attackRange,
        attackCooldownMs,
        damage: 0, // Walapas not aggressive yet
        knockback: 0,
        speed: BASE_SPEED * ((walapa.definition.speed || 100) / 100),
      },

      state,
    };
  },

  applyResult(
    walapa: WalapaWithAI,
    result: BehaviorResult,
    deltaMs: number,
    _shared?: SharedContext
  ): void {
    if (!EnemyManager.isAIControlled()) return;

    const deltaSeconds = deltaMs / 1000;

    if (result.kind === 'idle') {
      return;
    }

    if (result.kind === 'move') {
      _direction.set(
        result.tx - walapa.position.x,
        result.ty - walapa.position.y,
        result.tz - walapa.position.z
      );

      const dist = _direction.length();
      if (dist > 0.1) {
        _direction.normalize();

        const speed = (BASE_SPEED * ((walapa.definition.speed || 100) / 100)) * (result.speedMultiplier ?? 1);
        const moveAmount = Math.min(speed * deltaSeconds, dist);

        walapa.position.x += _direction.x * moveAmount;
        walapa.position.y += _direction.y * moveAmount;
        walapa.position.z += _direction.z * moveAmount;

        // Face movement direction (Y rotation)
        walapa.rotation = Math.atan2(_direction.x, _direction.z);
      }
    }

    if (result.kind === 'attack') {
      walapa.lastAttackAt = performance.now();

      if (locomotionContext?.onPlayerHit) {
        _direction.set(result.dirX, 0, result.dirZ).normalize();
        locomotionContext.onPlayerHit(result.damage, result.knockback, _direction);
      }
    }
  },

  getBehaviors(walapa: WalapaWithAI): BehaviorModule[] {
    const behaviors = walapa.definition.ai_config?.behaviors ?? ['wander'];
    return getBehaviorsByIds(behaviors);
  },
};
