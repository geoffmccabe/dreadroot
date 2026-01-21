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
import { ShnakeAdapter, type ShnakeWithAI, setShnakeLocomotionContext, cleanupShnakeResources } from '../adapters/ShnakeAdapter';
import { ShwarmAdapter, type ShwarmWithAI, setShwarmLocomotionContext, cleanupShwarmResources } from '../adapters/ShwarmAdapter';
import { frameLoop } from '@/lib/frameLoop';
import type { ShnakeInstance } from '@/features/shnake/types';
import type { ShwarmInstance } from '@/features/shwarm/hooks/useShwarmSystem';
import type { PlantedTree } from '@/features/trees/types';

interface UseEnemyAIOptions {
  /** Camera ref for player position updates */
  cameraRef: React.RefObject<THREE.Camera>;
  
  /** Shnake instances ref */
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  
  /** Shwarm instances ref */
  shwarmsRef: React.RefObject<ShwarmInstance[]>;
  
  /** Whether AI system is enabled */
  isEnabled: boolean;
  
  /** Whether AI controls movement (Phase 4) or runs in advisory mode (Phase 3) */
  aiControlled?: boolean;
  
  // Shnake locomotion context
  plantedTrees?: PlantedTree[];
  blocksRef?: React.RefObject<{ position_x: number; position_y: number; position_z: number }[]>;
  treeBlocksByTierRef?: React.RefObject<Map<number, Map<string, string>>>;
  onPlayerHit?: (damage: number, knockback: number, direction: THREE.Vector3) => void;
  onShnakeHeadMoved?: (shnakeId: string) => void;
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
  isEnabled,
  aiControlled = false,
  plantedTrees,
  blocksRef,
  treeBlocksByTierRef,
  onPlayerHit,
  onShnakeHeadMoved,
}: UseEnemyAIOptions) {
  // Track registered enemy IDs to detect changes (reused, not reallocated)
  const registeredShnakesRef = useRef<Set<string>>(new Set());
  const registeredShwarmsRef = useRef<Set<string>>(new Set());
  
  // Separate reusable sets for sync operations (avoids new Set() allocation each sync)
  // Using separate sets prevents race condition when both sync at same interval
  const tempShnakeIdsRef = useRef<Set<string>>(new Set());
  const tempShwarmIdsRef = useRef<Set<string>>(new Set());
  
  // Update locomotion context when deps change
  useEffect(() => {
    if (!isEnabled || !aiControlled) return;
    
    // Update shnake locomotion context
    setShnakeLocomotionContext({
      plantedTrees: plantedTrees ?? [],
      worldBlocks: blocksRef?.current ?? [],
      treeBlocksByTier: treeBlocksByTierRef?.current ?? null,
      onPlayerHit,
      onHeadMoved: onShnakeHeadMoved,
    });
    
    // Update shwarm locomotion context
    setShwarmLocomotionContext({
      onPlayerHit,
    });
  }, [isEnabled, aiControlled, plantedTrees, blocksRef, treeBlocksByTierRef, onPlayerHit, onShnakeHeadMoved]);
  
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
  
  // Initialize EnemyManager on mount
  useEffect(() => {
    if (!isEnabled) return;
    
    // Set AI controlled mode on manager
    EnemyManager.setAIControlled(aiControlled);
    EnemyManager.initialize();
    
    // Register player position updater with frameLoop (priority 35: before enemyAI at 40)
    const unregisterPlayerUpdate = frameLoop.register(
      'enemyAI-playerPos',
      () => {
        const camera = cameraRef.current;
        if (camera) {
          EnemyManager.setPlayerPosition(
            camera.position.x,
            camera.position.y,
            camera.position.z
          );
        }
      },
      35
    );
    
    return () => {
      unregisterPlayerUpdate();
      EnemyManager.shutdown();
      registeredShnakesRef.current.clear();
      registeredShwarmsRef.current.clear();
    };
  }, [isEnabled, aiControlled, cameraRef]);
  
  // Sync enemy registrations periodically
  useEffect(() => {
    if (!isEnabled) return;
    
    const syncInterval = setInterval(() => {
      syncShnakes();
      syncShwarms();
    }, 500); // Check every 500ms
    
    return () => clearInterval(syncInterval);
  }, [isEnabled, syncShnakes, syncShwarms]);
  
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
