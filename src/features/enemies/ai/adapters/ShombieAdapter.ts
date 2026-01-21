/**
 * ShombieAdapter - Bridges Shombie instances to the universal AI system
 */

import * as THREE from 'three';
import type { ShombieInstance } from '@/features/shombie/types';
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
import { KNOCKBACK_DECAY_RATE, SHOMBIE_GRAVITY } from '@/features/shombie/constants';

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
      hasLineOfSight: true, // Ground enemies assume LOS for now
      
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
    
    if (result.kind === 'idle') {
      return;
    }
    
    if (result.kind === 'move') {
      // Calculate direction to target
      _direction.set(
        result.tx - shombie.position.x,
        0,
        result.tz - shombie.position.z
      );
      
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
    }
    
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
