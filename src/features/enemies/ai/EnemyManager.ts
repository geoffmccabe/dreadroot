/**
 * EnemyManager - Central AI tick distribution via frameLoop
 * 
 * Replaces individual enemy schedulers (setInterval, requestAnimationFrame)
 * with a unified, LOD-aware tick system.
 */

import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { BehaviorBrain } from './BehaviorBrain';
import { EnemySpatialIndex } from './EnemySpatialIndex';
import {
  type EnemyAdapter,
  type RegisteredEnemy,
  type SharedContext,
  AILodLevel,
  LOD_CONFIG,
  TICK_INTERVALS_MS,
} from './types';

// Pre-allocated scratch vectors for zero-allocation locomotion
const _scratchVec1 = new THREE.Vector3();
const _scratchVec2 = new THREE.Vector3();
const _scratchVec3 = new THREE.Vector3();

/**
 * Singleton manager for all enemy AI updates.
 * Registers once with frameLoop and distributes ticks based on LOD.
 */
class EnemyManagerClass {
  private enemies: Map<string, RegisteredEnemy> = new Map();
  private brain: BehaviorBrain = new BehaviorBrain();
  private spatialIndex: EnemySpatialIndex = new EnemySpatialIndex();
  
  // Player position (updated each frame from camera ref)
  private playerX = 0;
  private playerY = 0;
  private playerZ = 0;
  
  // Timing
  private lastFrameTime = 0;
  private isRegistered = false;
  
  // Phase 4: Whether AI controls movement (true) or runs in advisory mode (false)
  private aiControlled = false;
  
  // Pre-allocated array for spatial entries (reused each frame)
  private spatialEntries: Array<{ id: string; type: string; x: number; y: number; z: number }> = [];
  
  // Squared LOD distances for faster comparison (no sqrt needed)
  private readonly LOD_FULL_DIST_SQ = LOD_CONFIG.FULL_DISTANCE * LOD_CONFIG.FULL_DISTANCE;
  private readonly LOD_THROTTLED_DIST_SQ = LOD_CONFIG.THROTTLED_DISTANCE * LOD_CONFIG.THROTTLED_DISTANCE;
  private readonly LOD_WAKE_DIST_SQ = LOD_CONFIG.WAKE_DISTANCE * LOD_CONFIG.WAKE_DISTANCE;
  
  // Shared context (reused each frame)
  private sharedContext: SharedContext = {
    playerX: 0,
    playerY: 0,
    playerZ: 0,
    deltaMs: 0,
    elapsedMs: 0,
    scratchVec1: _scratchVec1,
    scratchVec2: _scratchVec2,
    scratchVec3: _scratchVec3,
  };
  
  /**
   * Set whether AI controls movement (Phase 4) or runs in advisory mode.
   */
  setAIControlled(controlled: boolean): void {
    this.aiControlled = controlled;
    console.log(`[EnemyManager] AI controlled mode: ${controlled}`);
  }
  
  /**
   * Check if AI is controlling movement.
   */
  isAIControlled(): boolean {
    return this.aiControlled;
  }
  
  /**
   * Initialize the manager and register with frameLoop.
   * Call once during app startup.
   */
  initialize(): void {
    if (this.isRegistered) return;
    
    frameLoop.register('enemyAI', this.tick.bind(this), 40); // Priority 40: after input, before render
    this.isRegistered = true;
    this.lastFrameTime = performance.now();
    
    console.log('[EnemyManager] Initialized and registered with frameLoop');
  }
  
  /**
   * Shutdown the manager and unregister from frameLoop.
   */
  shutdown(): void {
    if (!this.isRegistered) return;
    
    frameLoop.unregister('enemyAI');
    this.isRegistered = false;
    this.enemies.clear();
    this.spatialIndex.clear();
    
    console.log('[EnemyManager] Shutdown complete');
  }
  
  /**
   * Update player position (call each frame from scene).
   */
  setPlayerPosition(x: number, y: number, z: number): void {
    this.playerX = x;
    this.playerY = y;
    this.playerZ = z;
  }
  
  /**
   * Register an enemy with its adapter.
   */
  register<TEnemy>(enemy: TEnemy, adapter: EnemyAdapter<TEnemy>): void {
    const id = adapter.getId(enemy);
    
    if (this.enemies.has(id)) {
      // Update existing registration
      const existing = this.enemies.get(id)!;
      existing.enemy = enemy;
      return;
    }
    
    this.enemies.set(id, {
      enemy,
      adapter: adapter as EnemyAdapter<unknown>,
      lodLevel: AILodLevel.FULL,
      lastTickTime: performance.now(),
      currentBehaviorId: null,
      behaviorState: {}, // Persistent state for behaviors
    });
  }
  
  /**
   * Unregister an enemy.
   */
  unregister(enemyId: string): void {
    this.enemies.delete(enemyId);
    this.spatialIndex.remove(enemyId);
  }
  
  /**
   * Get the spatial index for neighbor queries.
   */
  getSpatialIndex(): EnemySpatialIndex {
    return this.spatialIndex;
  }
  
  /**
   * Get count of registered enemies (for diagnostics).
   */
  get count(): number {
    return this.enemies.size;
  }
  
  /**
   * Get LOD distribution (for diagnostics).
   */
  getLodStats(): { full: number; throttled: number; frozen: number } {
    let full = 0, throttled = 0, frozen = 0;
    
    for (const reg of this.enemies.values()) {
      switch (reg.lodLevel) {
        case AILodLevel.FULL: full++; break;
        case AILodLevel.THROTTLED: throttled++; break;
        case AILodLevel.FROZEN: frozen++; break;
      }
    }
    
    return { full, throttled, frozen };
  }
  
  /**
   * Main tick function - called every frame by frameLoop.
   */
  private tick(_delta: number, elapsedTime: number): void {
    const now = performance.now();
    const deltaMs = (now - this.lastFrameTime);
    this.lastFrameTime = now;
    
    // Update shared context
    this.sharedContext.playerX = this.playerX;
    this.sharedContext.playerY = this.playerY;
    this.sharedContext.playerZ = this.playerZ;
    this.sharedContext.deltaMs = deltaMs;
    this.sharedContext.elapsedMs = elapsedTime * 1000;
    
    // Reuse pre-allocated array (clear without reallocating)
    this.spatialEntries.length = 0;
    
    // Process each enemy
    for (const [id, reg] of this.enemies) {
      const pos = reg.adapter.getPosition(reg.enemy);
      
      // Calculate squared distance to player (avoid sqrt for LOD checks)
      const dx = pos.x - this.playerX;
      const dy = pos.y - this.playerY;
      const dz = pos.z - this.playerZ;
      const distSq = dx * dx + dy * dy + dz * dz;
      
      // Determine LOD level with hysteresis (using squared distances)
      const newLod = this.calculateLodSq(distSq, reg.lodLevel);
      reg.lodLevel = newLod;
      
      // Skip frozen enemies entirely
      if (newLod === AILodLevel.FROZEN) {
        continue;
      }
      
      // Add to spatial index for neighbor queries
      this.spatialEntries.push({
        id,
        type: reg.adapter.getType(),
        x: pos.x,
        y: pos.y,
        z: pos.z,
      });
      
      // Check if enough time has passed for this LOD level
      const interval = TICK_INTERVALS_MS[newLod];
      const elapsed = now - reg.lastTickTime;
      
      if (elapsed < interval) {
        continue;
      }
      
      // Update last tick time
      reg.lastTickTime = now;
      
      // Build context and run brain (pass persistent behaviorState)
      const ctx = reg.adapter.buildContext(reg.enemy, this.sharedContext, reg.behaviorState);
      ctx.nearbyAllies = this.spatialIndex.countNearby(pos.x, pos.z, 16, ctx.entityType);
      
      const behaviors = reg.adapter.getBehaviors(reg.enemy);
      const { result, newBehaviorId } = this.brain.tick(
        ctx,
        behaviors,
        reg.currentBehaviorId,
        deltaMs
      );
      
      // Track behavior transitions
      if (newBehaviorId !== reg.currentBehaviorId) {
        reg.currentBehaviorId = newBehaviorId;
      }
      
      // Apply result via adapter
      if (result.kind !== 'idle') {
        reg.adapter.applyResult(reg.enemy, result, deltaMs);
      }
    }
    
    // Batch update spatial index
    this.spatialIndex.update(this.spatialEntries);
  }
  
  /**
   * Calculate LOD level using squared distances (avoid sqrt).
   */
  private calculateLodSq(distSq: number, currentLod: AILodLevel): AILodLevel {
    // If currently frozen, use wake distance (hysteresis)
    if (currentLod === AILodLevel.FROZEN) {
      if (distSq < this.LOD_WAKE_DIST_SQ) {
        return distSq < this.LOD_FULL_DIST_SQ ? AILodLevel.FULL : AILodLevel.THROTTLED;
      }
      return AILodLevel.FROZEN;
    }
    
    // Normal LOD calculation
    if (distSq < this.LOD_FULL_DIST_SQ) {
      return AILodLevel.FULL;
    }
    if (distSq < this.LOD_THROTTLED_DIST_SQ) {
      return AILodLevel.THROTTLED;
    }
    return AILodLevel.FROZEN;
  }
}

// Singleton export
export const EnemyManager = new EnemyManagerClass();
