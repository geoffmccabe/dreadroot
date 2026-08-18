/**
 * EnemyManager - Central AI tick distribution via frameLoop
 * 
 * Replaces individual enemy schedulers (setInterval, requestAnimationFrame)
 * with a unified, LOD-aware tick system.
 */

import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { BehaviorBrain } from './BehaviorBrain';
import { compileTree, type CompiledNode } from './behaviorTree';
import {
  behaviorRegistry, defaultTree, makeCreatureCtx, runCreatureTree,
  type CreatureBTContext,
} from './behaviorTreeBridge';

/** Creature types that run on the data-driven behavior tree instead of
 *  BehaviorBrain. The bridge is proven-equivalent, so this is behavior-neutral.
 *  TOGGLE: remove a type to instantly revert it to the old brain; empty the Set
 *  to revert everything. Only the pure brain-driven enemies belong here — the
 *  friends (shtickman/walapa) and shpider run separate state machines and need a
 *  rewrite, not a flag, to join (Phase B). */
const BT_ENABLED_TYPES = new Set<string>([
  'shombie', 'shroomer', 'vortax', 'shnake', 'shwarm',
]);
import { EnemySpatialIndex } from './EnemySpatialIndex';
import { entityFeed } from '../feed/entityFeed';
import { diagnostics } from '@/lib/diagnosticsLogger';
import {
  type EnemyAdapter,
  type RegisteredEnemy,
  type SharedContext,
  type EnemyEntry,
  AILodLevel,
  LOD_CONFIG,
  TICK_INTERVALS_MS,
  DEFAULT_ENEMY_MASS,
  DEFAULT_ENEMY_RADIUS,
} from './types';

// Debug flag - disable in production for FPS
const DEBUG_AI = false;

// Pre-allocated scratch vectors for zero-allocation locomotion
const _scratchVec1 = new THREE.Vector3();
const _scratchVec2 = new THREE.Vector3();
const _scratchVec3 = new THREE.Vector3();

// ── Inter-species hostility ─────────────────────────────────────────────────
// Which enemy types will fight each other (mutual). Extend freely. Rival
// targeting only kicks in when a PLAYER is within RIVAL_RANGE of the enemy, so
// off-screen mobs don't brawl where nobody can see it.
const RIVALS: Record<string, readonly string[]> = {
  shombie: ['shroomer'],
  shroomer: ['shombie'],
};
const RIVAL_RANGE = 100;                 // metres
const RIVAL_RANGE_SQ = RIVAL_RANGE * RIVAL_RANGE;
const PLAYER_COMMIT_MS = 5000;           // how long an enemy stays on the player
                                         // before re-evaluating (rival targets
                                         // are strict — until dead/out-of-range)
// Scratch: flat [id, type, id, type, …] of rival candidates (reused).
const _rivalCand: string[] = [];

/**
 * Singleton manager for all enemy AI updates.
 * Registers once with frameLoop and distributes ticks based on LOD.
 */
class EnemyManagerClass {
  private enemies: Map<string, RegisteredEnemy> = new Map();
  private brain: BehaviorBrain = new BehaviorBrain();
  /** Compiled behavior trees, cached by behavior-list key (compile once). */
  private btTreeCache: Map<string, CompiledNode> = new Map();
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
  private spatialEntries: EnemyEntry[] = [];
  // Non-AI enemy systems (e.g. shpiders) feed their entries into the single
  // shared index each frame via this provider — so the grid is ALL enemies,
  // not just AI-managed ones. Type-agnostic; the DO will feed the same way.
  private externalEntriesProvider: (() => readonly EnemyEntry[]) | null = null;
  
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
    if (DEBUG_AI) console.log(`[EnemyManager] AI controlled mode: ${controlled}`);
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
    
    if (DEBUG_AI) console.log('[EnemyManager] Initialized and registered with frameLoop');
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
    
    if (DEBUG_AI) console.log('[EnemyManager] Shutdown complete');
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
    
    const type = adapter.getType();
    // Physics: mass + radius captured once at registration (constant per
    // instance). Type-agnostic — any adapter that implements getMass/getRadius
    // participates in mass-based physics; others fall back to defaults.
    const mass = adapter.getMass ? adapter.getMass(enemy) : DEFAULT_ENEMY_MASS;
    const radius = adapter.getRadius ? adapter.getRadius(enemy) : DEFAULT_ENEMY_RADIUS;
    this.enemies.set(id, {
      enemy,
      adapter: adapter as EnemyAdapter<unknown>,
      lodLevel: AILodLevel.FULL,
      lastTickTime: performance.now(),
      currentBehaviorId: null,
      behaviorState: {}, // Persistent state for behaviors
      // Pre-allocated spatial entry - reused each frame (no object allocation)
      spatialEntry: { id, type, x: 0, y: 0, z: 0, mass, radius },
    });
  }
  
  /**
   * Highest standable enemy TOP beneath a point's feet (for the player and for
   * other enemies to land/stand on). Returns the world Y to rest at, or null.
   *
   * @param x,z      the standing entity's horizontal position
   * @param feetY    its feet Y
   * @param reach    how far ABOVE the top the feet may be and still catch it
   *                 (the fall/landing tolerance)
   * @param excludeId an enemy id to ignore (so an enemy doesn't stand on itself)
   * @param footPad  extra footprint radius (e.g. the player/enemy's own radius)
   */
  getStandableTopNear(
    x: number, z: number, feetY: number, reach: number,
    excludeId?: string, footPad = 0,
  ): number | null {
    const near = this.spatialIndex.getNearby(x, z, 3);
    let best = -Infinity;
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.id === excludeId) continue;
      const top = e.topY ?? 0;
      if (top <= e.y + 0.3) continue; // no real standable height
      const dx = e.x - x, dz = e.z - z;
      const r = e.radius + footPad;
      if (dx * dx + dz * dz > r * r) continue; // outside its footprint
      // Feet at/just-above the top (catch the fall) or just-sunk (standing).
      if (feetY <= top + reach && feetY >= top - 0.3 && top > best) best = top;
    }
    return best > -Infinity ? best : null;
  }

  /**
   * Force an enemy to (re)target the player — used when the player damages it,
   * so it can break off a rival fight to retaliate. Overrides the target lock.
   */
  retargetToPlayer(enemyId: string): void {
    const reg = this.enemies.get(enemyId);
    if (reg) {
      reg.aiTargetType = 'player';
      reg.aiTargetEnemyId = null;
      reg.aiAggro = true; // angry — stick on the player (20%/10s to peel off)
      reg.aiRetargetAt = performance.now() + 10000;
    }
  }

  /**
   * Unregister an enemy.
   */
  unregister(enemyId: string): void {
    this.enemies.delete(enemyId);
    this.spatialIndex.remove(enemyId);
  }
  
  /**
   * Get a registered enemy entry by ID (for direct state access).
   */
  getEntry(enemyId: string): RegisteredEnemy | undefined {
    return this.enemies.get(enemyId);
  }

  /**
   * Register a provider of extra (non-AI-managed) enemy entries to merge into
   * the shared spatial index each frame. Pass null to clear.
   */
  setExternalEntriesProvider(fn: (() => readonly EnemyEntry[]) | null): void {
    this.externalEntriesProvider = fn;
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
   * Clear revenge state for all enemies.
   * Call this when player dies/respawns to reset shnake AI state.
   */
  clearAllRevengeStates(): void {
    for (const reg of this.enemies.values()) {
      // Clear revenge-related state
      reg.behaviorState.revengeTarget = null;
      reg.behaviorState.returningHome = false;
      reg.behaviorState.isIndignant = false;
      reg.behaviorState.indignantStartTime = undefined;
      reg.behaviorState.isStunned = false;
      reg.behaviorState.stunnedUntil = undefined;
      
      // Reset current behavior so shnake re-evaluates from scratch
      reg.currentBehaviorId = null;
    }
    
    if (DEBUG_AI) console.log('[EnemyManager] Cleared all revenge states (player respawned)');
  }
  
  /**
   * Main tick function - called every frame by frameLoop.
   */
  /**
   * Decide what `reg` is attacking this tick and aim the shared context at it.
   * Default is the player; if this enemy has rivals AND a player is within
   * RIVAL_RANGE (so it's witnessable), it may instead pick a nearby rival —
   * flat-random among the player + every rival in range (no prioritisation).
   * A choice sticks for ~RETARGET_MS so targets don't thrash.
   */
  private selectTargetInto(
    reg: RegisteredEnemy,
    myId: string,
    pos: { x: number; y: number; z: number },
    distSqToPlayer: number,
    now: number,
  ): void {
    const myType = reg.spatialEntry.type;
    const rivals = RIVALS[myType];

    // COMMIT to the chosen target — no timed re-roll (that caused the
    // flip-flopping). Only re-pick when the current target is lost: a rival
    // that died/despawned or drifted beyond RIVAL_RANGE, or the player getting
    // farther than RIVAL_RANGE.
    let valid = false;
    if (reg.aiTargetType && reg.aiTargetType !== 'player' && reg.aiTargetEnemyId) {
      // RIVAL target: strict commit — valid until it dies/despawns or leaves 100m.
      const r = this.enemies.get(reg.aiTargetEnemyId);
      if (r) {
        const rp = r.adapter.getPosition(r.enemy);
        const ddx = rp.x - pos.x, ddz = rp.z - pos.z;
        valid = (ddx * ddx + ddz * ddz) <= RIVAL_RANGE_SQ;
      }
    } else if (reg.aiTargetType === 'player') {
      if (distSqToPlayer > RIVAL_RANGE_SQ) {
        valid = false;
      } else if (reg.aiAggro) {
        // ANGRY (took player damage): stay on the player; only a 20% chance each
        // 10s to peel off to a rival.
        if (now >= (reg.aiRetargetAt ?? 0)) {
          if (Math.random() < 0.2) {
            valid = false; // peel off — re-pick below (clears aggro)
          } else {
            reg.aiRetargetAt = now + 10000; // stay angry for another 10s
            valid = true;
          }
        } else {
          valid = true;
        }
      } else {
        // Normal player target: committed for PLAYER_COMMIT_MS, then re-evaluate
        // (so enemies don't all funnel onto the player forever).
        valid = now < (reg.aiRetargetAt ?? 0);
      }
    }

    if (!valid) {
      reg.aiTargetType = 'player';
      reg.aiTargetEnemyId = null;
      reg.aiAggro = false;
      reg.aiRetargetAt = now + PLAYER_COMMIT_MS;
      // Rivals only count when a player is near enough to see the fight.
      if (rivals && rivals.length > 0 && distSqToPlayer <= RIVAL_RANGE_SQ) {
        _rivalCand.length = 0;
        const near = this.spatialIndex.getNearby(pos.x, pos.z, RIVAL_RANGE);
        for (let i = 0; i < near.length; i++) {
          const e = near[i];
          if (e.id === myId || !rivals.includes(e.type)) continue;
          if (!this.enemies.has(e.id)) continue; // must be resolvable to a ref
          _rivalCand.push(e.id, e.type);
        }
        const rivalCount = _rivalCand.length / 2;
        // Flat random over [player] + each rival (player is candidate index 0).
        const pick = Math.floor(Math.random() * (rivalCount + 1));
        if (pick < rivalCount) {
          reg.aiTargetEnemyId = _rivalCand[pick * 2];
          reg.aiTargetType = _rivalCand[pick * 2 + 1];
        }
      }
    }

    // Resolve the (cached) target → shared context.
    if (reg.aiTargetType && reg.aiTargetType !== 'player' && reg.aiTargetEnemyId) {
      const rival = this.enemies.get(reg.aiTargetEnemyId);
      if (rival) {
        const rp = rival.adapter.getPosition(rival.enemy);
        this.sharedContext.playerX = rp.x;
        this.sharedContext.playerY = rp.y;
        this.sharedContext.playerZ = rp.z;
        this.sharedContext.aiTargetEnemy = rival.enemy;
        this.sharedContext.aiTargetEnemyType = reg.aiTargetType;
        return;
      }
      // Rival gone — fall back to the player.
      reg.aiTargetType = 'player';
      reg.aiTargetEnemyId = null;
    }
    this.sharedContext.playerX = this.playerX;
    this.sharedContext.playerY = this.playerY;
    this.sharedContext.playerZ = this.playerZ;
    this.sharedContext.aiTargetEnemy = undefined;
    this.sharedContext.aiTargetEnemyType = undefined;
  }

  private tick(_delta: number, elapsedTime: number): void {
    diagnostics.startTiming('enemyAI');
    
    const now = performance.now();
    const deltaMs = (now - this.lastFrameTime);
    this.lastFrameTime = now;
    
    // Update shared context
    this.sharedContext.playerX = this.playerX;
    this.sharedContext.playerY = this.playerY;
    this.sharedContext.playerZ = this.playerZ;
    this.sharedContext.deltaMs = deltaMs;
    this.sharedContext.elapsedMs = elapsedTime * 1000;
    
    // EntityFeed seam: read the mode ONCE per tick, not per enemy. In the
    // default 'local' mode both are false and the seam costs two booleans.
    const feedRemote = entityFeed.isRemote();
    const feedShadow = entityFeed.getMode() === 'shadow';

    // Reuse pre-allocated array (clear without reallocating)
    this.spatialEntries.length = 0;
    
    // Process each enemy
    for (const [id, reg] of this.enemies) {
      // Remote authority: the server decides where this entity is, so write
      // its transform on before anything reads the position.
      if (feedRemote && reg.adapter.setTransform !== undefined) {
        const fs = entityFeed.get(id);
        if (fs !== undefined) reg.adapter.setTransform(reg.enemy, fs.x, fs.y, fs.z, fs.yaw);
      }

      const pos = reg.adapter.getPosition(reg.enemy);
      
      // Calculate squared distance to player (avoid sqrt for LOD checks)
      const dx = pos.x - this.playerX;
      const dy = pos.y - this.playerY;
      const dz = pos.z - this.playerZ;
      const distSq = dx * dx + dy * dy + dz * dz;
      
      // Determine LOD level with hysteresis (using squared distances)
      const newLod = this.calculateLodSq(distSq, reg.lodLevel);
      reg.lodLevel = newLod;

      // Airborne enemies (e.g. blast-launched/tumbling shombies) must keep
      // simulating every frame regardless of LOD/throttle — otherwise a frozen
      // one hangs as a "phantom" in the sky. Opt-in per adapter so naturally-
      // elevated enemies (hovering shwarms) still freeze normally.
      const airborne = reg.adapter.isAirborne ? reg.adapter.isAirborne(reg.enemy) : false;

      // Skip frozen enemies entirely — unless airborne.
      if (newLod === AILodLevel.FROZEN && !airborne) {
        continue;
      }
      
      // Update pre-allocated spatial entry (zero allocation) and add to array
      const entry = reg.spatialEntry;
      entry.x = pos.x;
      entry.y = pos.y;
      entry.z = pos.z;
      // Publish the standable top surface so players + other enemies can land
      // on it (0 height → not standable).
      entry.topY = pos.y + (reg.adapter.getHeight ? reg.adapter.getHeight(reg.enemy) : 0);
      this.spatialEntries.push(entry);

      // Shadow mode: grade the server against the local sim without letting it
      // change anything the player sees.
      if (feedShadow) entityFeed.compare(id, pos.x, pos.y, pos.z);

      // Remote mode: the server already decided. Skip all local decision-making
      // for this entity (its spatial entry above is still published, so
      // collision, targeting and standability keep working).
      if (feedRemote) continue;

      // Check if enough time has passed for this LOD level
      const interval = TICK_INTERVALS_MS[newLod];
      const elapsed = now - reg.lastTickTime;
      
      if (elapsed < interval && !airborne) {
        continue;
      }

      // Update last tick time
      reg.lastTickTime = now;
      
      // Choose this enemy's target (the player or a nearby rival) and point the
      // shared context's target slot at it, so the chase/attack behaviors home
      // in on whichever was chosen.
      this.selectTargetInto(reg, id, pos, distSq, now);

      // Build context and run brain (pass persistent behaviorState)
      const ctx = reg.adapter.buildContext(reg.enemy, this.sharedContext, reg.behaviorState);
      // NOTE: nearbyAllies computation removed - no behaviors currently use it.
      // When flocking is added, compute lazily only for behaviors that need it.
      
      const behaviors = reg.adapter.getBehaviors(reg.enemy);
      // No type annotation: `BehaviorResult` is not a name that exists. It is erased at compile
      // time so it never threw, but it kept the undeclared-name check permanently red, and a check
      // with a known failure in it is a check nobody reads.
      let result;
      let newBehaviorId: string | null;

      if (BT_ENABLED_TYPES.has(ctx.entityType)) {
        // Behavior-tree path — proven drop-in for BehaviorBrain. The compiled
        // tree + per-enemy context are resolved ONCE (first tick) and cached on
        // reg, so the hot path is just sync + run — NO per-tick allocation.
        let cctx = reg.creatureCtx as CreatureBTContext | undefined;
        let tree = reg.btTree as CompiledNode | undefined;
        if (!cctx || !tree) {
          const key = behaviors.map((b) => b.id).join(',');
          tree = this.btTreeCache.get(key);
          if (!tree) {
            tree = compileTree(defaultTree(behaviors), behaviorRegistry(behaviors));
            this.btTreeCache.set(key, tree);
          }
          reg.btTree = tree;
          cctx = makeCreatureCtx(behaviors);
          reg.creatureCtx = cctx;
        }
        cctx.currentBehaviorId = reg.currentBehaviorId;
        result = runCreatureTree(tree, cctx, ctx, elapsed);
        // Empty behavior list → idle + forget the behavior, exactly as
        // BehaviorBrain does (newBehaviorId=null for no behaviors).
        newBehaviorId = behaviors.length === 0 ? null : cctx.currentBehaviorId;
      } else {
        const r = this.brain.tick(ctx, behaviors, reg.currentBehaviorId, elapsed);
        result = r.result;
        newBehaviorId = r.newBehaviorId;
      }

      // Track behavior transitions
      if (newBehaviorId !== reg.currentBehaviorId) {
        diagnostics.behaviorTransitions++;
        if (DEBUG_AI) {
          console.log(`[AI] ${id} behavior: ${reg.currentBehaviorId} -> ${newBehaviorId} | result: ${result.kind}`);
        }
        reg.currentBehaviorId = newBehaviorId;
      }
      
      // Apply result via adapter (always call - gravity/knockback must run even when idle)
      if (DEBUG_AI && result.kind === 'move') {
        console.log(`[AI] ${id} moving to (${result.tx.toFixed(1)}, ${result.ty.toFixed(1)}, ${result.tz.toFixed(1)})`);
      }
      reg.adapter.applyResult(reg.enemy, result, elapsed, this.sharedContext);
    }
    
    // Merge non-AI enemies (shpiders, etc.) into the same shared index.
    if (this.externalEntriesProvider) {
      const ext = this.externalEntriesProvider();
      for (let i = 0; i < ext.length; i++) this.spatialEntries.push(ext[i]);
    }

    // Batch update spatial index
    this.spatialIndex.update(this.spatialEntries);
    
    // Capture enemy AI stats for diagnostics
    const stats = this.getLodStats();
    diagnostics.captureEnemyStats(this.count, stats.full, stats.throttled, stats.frozen);
    
    diagnostics.recordTiming('enemyAI');
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
