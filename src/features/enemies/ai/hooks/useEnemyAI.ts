/**
 * useEnemyAI - Integrates EnemyManager with React Three Fiber scene
 * 
 * Phase 4: Full locomotion control - AI system drives enemy movement.
 * 
 * Handles:
 * - EnemyManager initialization and shutdown
 * - Player position updates via frameLoop
 * - Enemy registration/unregistration
 * - Locomotion context for movement execution
 */

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { EnemyManager } from '../EnemyManager';
import { ShnakeAdapter, type ShnakeWithAI, setShnakeLocomotionContext, cleanupShnakeResources, markShnakeAttacked } from '../adapters/ShnakeAdapter';
import { ShwarmAdapter, type ShwarmWithAI, setShwarmLocomotionContext, cleanupShwarmResources } from '../adapters/ShwarmAdapter';
import { ShombieAdapter, type ShombieWithAI, setShombieLocomotionContext } from '../adapters/ShombieAdapter';
import { WalapaAdapter, type WalapaWithAI, setWalapaLocomotionContext } from '../adapters/WalapaAdapter';
import { ShtickmanAdapter, type ShtickmanWithAI, setShtickmanLocomotionContext } from '../adapters/ShtickmanAdapter';
import { frameLoop } from '@/lib/frameLoop';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';
import type { ShnakeInstance } from '@/features/shnake/types';
import type { ShwarmInstance } from '@/features/shwarm/hooks/useShwarmSystem';
import type { ShombieInstance } from '@/features/shombie/types';
import type { WalapaInstance } from '@/features/walapa/types';
import type { ShtickmanInstance } from '@/features/shtickman/types';
import type { PlantedTree } from '@/features/trees/types';

interface UseEnemyAIOptions {
  /** Camera ref for player position updates */
  cameraRef: React.RefObject<THREE.Camera>;
  
  /** Shnake instances ref */
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  
  /** Shwarm instances ref */
  shwarmsRef: React.RefObject<ShwarmInstance[]>;
  
  /** Shombie instances ref */
  shombiesRef: React.RefObject<ShombieInstance[]>;
  
  /** Whether AI system is enabled */
  isEnabled: boolean;
  
  /** Whether AI controls movement (Phase 4) or runs in advisory mode (Phase 3) */
  aiControlled?: boolean;
  
  // Shnake locomotion context
  plantedTrees?: PlantedTree[];
  blocksRef?: React.RefObject<{ position_x: number; position_y: number; position_z: number }[]>;
  treeBlocksByTierRef?: React.RefObject<Map<number, Map<string, string>>>;
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3, shnakeId?: string) => void;
  onShnakeHeadMoved?: (shnakeId: string) => void;
  onIndignantRoar?: (shnakeId: string, volume: number) => void;
  onTriggerWiggle?: (shnakeId: string) => void;
  
  // Shombie locomotion context
  onShombiePlayerHit?: (damage: number, knockbackForce: number, direction: THREE.Vector3) => void;

  // Walapa instances ref
  walapasRef?: React.RefObject<WalapaInstance[]>;
  onWalapaPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;

  // Shtickman instances ref
  shtickmenRef?: React.RefObject<ShtickmanInstance[]>;
  onShtickmanPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
}

/**
 * Hook to integrate the universal AI system with the scene.
 * 
 * Phase 4: Full locomotion control mode.
 * When aiControlled=true, adapters execute movement via locomotion layer.
 * Legacy movement hooks should be disabled when aiControlled=true.
 */
export function useEnemyAI({
  cameraRef,
  shnakesRef,
  shwarmsRef,
  shombiesRef,
  isEnabled,
  aiControlled = false,
  plantedTrees,
  blocksRef,
  treeBlocksByTierRef,
  onPlayerHit,
  onShnakeHeadMoved,
  onIndignantRoar,
  onTriggerWiggle,
  onShombiePlayerHit,
  walapasRef,
  onWalapaPlayerHit,
  shtickmenRef,
  onShtickmanPlayerHit,
}: UseEnemyAIOptions) {
  // Track registered enemy IDs to detect changes (reused, not reallocated)
  const registeredShnakesRef = useRef<Set<string>>(new Set());
  const registeredShwarmsRef = useRef<Set<string>>(new Set());
  const registeredShombiesRef = useRef<Set<string>>(new Set());
  
  // Separate reusable sets for sync operations (avoids new Set() allocation each sync)
  // Using separate sets prevents race condition when both sync at same interval
  const tempShnakeIdsRef = useRef<Set<string>>(new Set());
  const tempShwarmIdsRef = useRef<Set<string>>(new Set());
  const tempShombieIdsRef = useRef<Set<string>>(new Set());
  const registeredWalapasRef = useRef<Set<string>>(new Set());
  const registeredShtickmenRef = useRef<Set<string>>(new Set());
  const tempWalapaIdsRef = useRef<Set<string>>(new Set());
  const tempShtickmanIdsRef = useRef<Set<string>>(new Set());
  
  // Update locomotion context when deps change
  useEffect(() => {
    if (!isEnabled || !aiControlled) return;
    
    // Build O(1) tree lookup map
    const treeById = new Map<string, PlantedTree>();
    for (const t of (plantedTrees ?? [])) {
      treeById.set(t.id, t);
    }

    // Update shnake locomotion context (no worldBlocks - uses collisionGrid O(1) lookup)
    setShnakeLocomotionContext({
      plantedTrees: plantedTrees ?? [],
      treeById,
      treeBlocksByTier: treeBlocksByTierRef?.current ?? null,
      onPlayerHit,
      onHeadMoved: onShnakeHeadMoved,
      onIndignantRoar,
      onTriggerWiggle,
    });
    
    // Update shwarm locomotion context
    setShwarmLocomotionContext({
      onPlayerHit,
    });
    
    // Update shombie locomotion context
    setShombieLocomotionContext({
      onPlayerHit: onShombiePlayerHit,
    });

    // Update walapa locomotion context
    setWalapaLocomotionContext({
      onPlayerHit: onWalapaPlayerHit,
    });

    // Update shtickman locomotion context
    setShtickmanLocomotionContext({
      onPlayerHit: onShtickmanPlayerHit,
    });
  }, [isEnabled, aiControlled, plantedTrees, treeBlocksByTierRef, onPlayerHit, onShnakeHeadMoved, onIndignantRoar, onTriggerWiggle, onShombiePlayerHit, onWalapaPlayerHit, onShtickmanPlayerHit]);
  
  // Stable sync function for shnakes (avoids stale closures)
  // OPTIMIZED: Reuses tempShnakeIds set instead of allocating new Set each call
  const syncShnakes = useCallback(() => {
    const shnakes = shnakesRef.current ?? [];
    const tempIds = tempShnakeIdsRef.current;
    tempIds.clear();
    
    // Build current IDs without allocation
    for (const s of shnakes) {
      tempIds.add(s.id);
    }
    
    const registered = registeredShnakesRef.current;
    
    // Register new shnakes
    for (const shnake of shnakes) {
      if (!registered.has(shnake.id) && shnake.isActive) {
        EnemyManager.register(shnake as ShnakeWithAI, ShnakeAdapter);
        registered.add(shnake.id);
      }
    }
    
    // Unregister removed shnakes and cleanup resources
    for (const id of registered) {
      if (!tempIds.has(id)) {
        cleanupShnakeResources(id);
        EnemyManager.unregister(id);
        registered.delete(id);
      }
    }
  }, [shnakesRef]);
  
  // Stable sync function for shwarms (avoids stale closures)
  // OPTIMIZED: Reuses tempShwarmIds set instead of allocating new Set each call
  const syncShwarms = useCallback(() => {
    const shwarms = shwarmsRef.current ?? [];
    const tempIds = tempShwarmIdsRef.current;
    tempIds.clear();
    
    // Build current IDs without allocation
    for (const s of shwarms) {
      tempIds.add(s.id);
    }
    
    const registered = registeredShwarmsRef.current;
    
    // Register new shwarms
    for (const shwarm of shwarms) {
      if (!registered.has(shwarm.id) && shwarm.isActive) {
        EnemyManager.register(shwarm as ShwarmWithAI, ShwarmAdapter);
        registered.add(shwarm.id);
      }
    }
    
    // Unregister removed shwarms and cleanup resources
    for (const id of registered) {
      if (!tempIds.has(id)) {
        // Find shwarm to get its blocks for cleanup
        const shwarm = shwarms.find(s => s.id === id);
        if (shwarm) {
          cleanupShwarmResources(id, shwarm.blocks);
        }
        EnemyManager.unregister(id);
        registered.delete(id);
      }
    }
  }, [shwarmsRef]);
  
  // Stable sync function for shombies
  const syncShombies = useCallback(() => {
    const shombies = shombiesRef.current ?? [];
    const tempIds = tempShombieIdsRef.current;
    tempIds.clear();
    
    // Build current IDs without allocation
    for (const s of shombies) {
      tempIds.add(s.id);
    }
    
    const registered = registeredShombiesRef.current;
    
    // Register new shombies
    for (const shombie of shombies) {
      if (!registered.has(shombie.id) && shombie.isActive) {
        EnemyManager.register(shombie as ShombieWithAI, ShombieAdapter);
        registered.add(shombie.id);
      }
    }
    
    // Unregister removed shombies
    for (const id of registered) {
      if (!tempIds.has(id)) {
        EnemyManager.unregister(id);
        registered.delete(id);
      }
    }
  }, [shombiesRef]);

  // Walapas use their own dedicated state machine (useWalapaSystem.updateMovement)
  // for tree-to-tree flying behavior — not registered with AI system.
  const syncWalapas = useCallback(() => {
    // No-op: walapas are not AI-controlled
  }, []);

  // Shtickmen use their own dedicated tree-patrol state machine (useShtickmanSystem.updateMovement)
  // — not registered with AI system.
  const syncShtickmen = useCallback(() => {
    // No-op: shtickmen are not AI-controlled
  }, []);

  // Initialize EnemyManager on mount
  useEffect(() => {
    if (!isEnabled) return;
    
    // Set AI controlled mode on manager
    EnemyManager.setAIControlled(aiControlled);
    EnemyManager.initialize();
    
    // Register player position updater with frameLoop (priority 35: before enemyAI at 40).
    // Reads the canonical snapshot — post-L2 this becomes reconciled server state.
    const unregisterPlayerUpdate = frameLoop.register(
      'enemyAI-playerPos',
      () => {
        const snap = getLocalPlayerSnapshot();
        EnemyManager.setPlayerPosition(snap.x, snap.y, snap.z);
      },
      35
    );
    
    return () => {
      unregisterPlayerUpdate();
      EnemyManager.shutdown();
      registeredShnakesRef.current.clear();
      registeredShwarmsRef.current.clear();
      registeredShombiesRef.current.clear();
      registeredWalapasRef.current.clear();
      registeredShtickmenRef.current.clear();
    };
  }, [isEnabled, aiControlled, cameraRef]);
  
  // Sync enemy registrations via throttled frameLoop (less timer contention than setInterval)
  useEffect(() => {
    if (!isEnabled) return;
    
    let accMs = 0;
    
    const unregister = frameLoop.register('enemyAI-sync', (delta) => {
      accMs += delta * 1000;
      if (accMs < 500) return;
      accMs = 0;
      
      syncShnakes();
      syncShwarms();
      syncShombies();
      syncWalapas();
      syncShtickmen();
    }, 34); // Near the playerPos updater priority

    return unregister;
  }, [isEnabled, syncShnakes, syncShwarms, syncShombies, syncWalapas, syncShtickmen]);
  
  // Wire markShnakeAttacked global to AI system when AI controls
  useEffect(() => {
    if (!isEnabled || !aiControlled) return;
    
    // Override the global to use AI's attacked state tracking
    (window as any).__markShnakeAttacked = markShnakeAttacked;
    
    return () => {
      // Only cleanup if we're still the owner
      if ((window as any).__markShnakeAttacked === markShnakeAttacked) {
        delete (window as any).__markShnakeAttacked;
      }
    };
  }, [isEnabled, aiControlled]);
  
  return {
    /** Get LOD distribution for debugging */
    getLodStats: () => EnemyManager.getLodStats(),
    
    /** Get total enemy count */
    getEnemyCount: () => EnemyManager.count,
    
    /** Get spatial index for queries */
    getSpatialIndex: () => EnemyManager.getSpatialIndex(),
    
    /** Whether AI is controlling movement */
    isAIControlled: aiControlled,
  };
}
