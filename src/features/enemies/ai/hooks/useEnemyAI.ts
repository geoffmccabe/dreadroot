/**
 * useEnemyAI - Integrates EnemyManager with React Three Fiber scene
 * 
 * Handles:
 * - EnemyManager initialization and shutdown
 * - Player position updates each frame
 * - Enemy registration/unregistration
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EnemyManager } from '../EnemyManager';
import { ShnakeAdapter, type ShnakeWithAI } from '../adapters/ShnakeAdapter';
import { ShwarmAdapter, type ShwarmWithAI } from '../adapters/ShwarmAdapter';
import type { ShnakeInstance } from '@/features/shnake/types';
import type { ShwarmInstance } from '@/features/shwarm/hooks/useShwarmSystem';

interface UseEnemyAIOptions {
  /** Camera ref for player position updates */
  cameraRef: React.RefObject<THREE.Camera>;
  
  /** Shnake instances ref */
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  
  /** Shwarm instances ref */
  shwarmsRef: React.RefObject<ShwarmInstance[]>;
  
  /** Whether AI system is enabled */
  isEnabled: boolean;
}

/**
 * Hook to integrate the universal AI system with the scene.
 * 
 * Phase 2: Runs in parallel with existing movement hooks.
 * Behaviors are evaluated but movement is still handled by legacy code.
 */
export function useEnemyAI({
  cameraRef,
  shnakesRef,
  shwarmsRef,
  isEnabled,
}: UseEnemyAIOptions) {
  // Track registered enemy IDs to detect changes
  const registeredShnakesRef = useRef<Set<string>>(new Set());
  const registeredShwarmsRef = useRef<Set<string>>(new Set());
  
  // Initialize EnemyManager on mount
  useEffect(() => {
    if (!isEnabled) return;
    
    EnemyManager.initialize();
    console.log('[useEnemyAI] EnemyManager initialized');
    
    return () => {
      EnemyManager.shutdown();
      registeredShnakesRef.current.clear();
      registeredShwarmsRef.current.clear();
      console.log('[useEnemyAI] EnemyManager shutdown');
    };
  }, [isEnabled]);
  
  // Sync shnake registrations
  useEffect(() => {
    if (!isEnabled) return;
    
    const syncInterval = setInterval(() => {
      const shnakes = shnakesRef.current ?? [];
      const currentIds = new Set(shnakes.map(s => s.id));
      const registered = registeredShnakesRef.current;
      
      // Register new shnakes
      for (const shnake of shnakes) {
        if (!registered.has(shnake.id) && shnake.isActive) {
          EnemyManager.register(shnake as ShnakeWithAI, ShnakeAdapter);
          registered.add(shnake.id);
        }
      }
      
      // Unregister removed shnakes
      for (const id of registered) {
        if (!currentIds.has(id)) {
          EnemyManager.unregister(id);
          registered.delete(id);
        }
      }
    }, 500); // Check every 500ms
    
    return () => clearInterval(syncInterval);
  }, [isEnabled, shnakesRef]);
  
  // Sync shwarm registrations
  useEffect(() => {
    if (!isEnabled) return;
    
    const syncInterval = setInterval(() => {
      const shwarms = shwarmsRef.current ?? [];
      const currentIds = new Set(shwarms.map(s => s.id));
      const registered = registeredShwarmsRef.current;
      
      // Register new shwarms
      for (const shwarm of shwarms) {
        if (!registered.has(shwarm.id) && shwarm.isActive) {
          EnemyManager.register(shwarm as ShwarmWithAI, ShwarmAdapter);
          registered.add(shwarm.id);
        }
      }
      
      // Unregister removed shwarms
      for (const id of registered) {
        if (!currentIds.has(id)) {
          EnemyManager.unregister(id);
          registered.delete(id);
        }
      }
    }, 500); // Check every 500ms
    
    return () => clearInterval(syncInterval);
  }, [isEnabled, shwarmsRef]);
  
  // Update player position each frame (via a separate effect that reads camera)
  useEffect(() => {
    if (!isEnabled) return;
    
    // Use RAF to update player position since we need camera.position each frame
    let rafId: number;
    
    const updatePlayerPosition = () => {
      const camera = cameraRef.current;
      if (camera) {
        EnemyManager.setPlayerPosition(
          camera.position.x,
          camera.position.y,
          camera.position.z
        );
      }
      rafId = requestAnimationFrame(updatePlayerPosition);
    };
    
    rafId = requestAnimationFrame(updatePlayerPosition);
    
    return () => cancelAnimationFrame(rafId);
  }, [isEnabled, cameraRef]);
  
  return {
    /** Get LOD distribution for debugging */
    getLodStats: () => EnemyManager.getLodStats(),
    
    /** Get total enemy count */
    getEnemyCount: () => EnemyManager.count,
    
    /** Get spatial index for queries */
    getSpatialIndex: () => EnemyManager.getSpatialIndex(),
  };
}
