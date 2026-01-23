// Water physics hook: handles underwater movement, oxygen, and camera effects

import { useRef, useCallback, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isInPool, isAtSurface, POOL_CONFIG } from '@/components/fortress/WaterPool';

export interface WaterPhysicsState {
  isSubmerged: boolean;
  oxygen: number;
  maxOxygen: number;
}

interface UseWaterPhysicsProps {
  enabled: boolean;
  onDamage?: (damage: number) => void;
  onStateChange?: (state: WaterPhysicsState) => void;
}

export function useWaterPhysics({ enabled, onDamage, onStateChange }: UseWaterPhysicsProps) {
  const { scene } = useThree();
  
  // State refs for high-frequency updates
  const isSubmergedRef = useRef(false);
  const oxygenRef = useRef(POOL_CONFIG.maxOxygen);
  const originalFogRef = useRef<THREE.Fog | THREE.FogExp2 | null>(null);
  const underwaterFogRef = useRef<THREE.Fog | null>(null);
  const lastDamageTimeRef = useRef(0);
  
  // Create underwater fog once
  useEffect(() => {
    underwaterFogRef.current = new THREE.Fog(
      POOL_CONFIG.underwaterFogColor,
      POOL_CONFIG.underwaterFogNear,
      POOL_CONFIG.underwaterFogFar
    );
    
    return () => {
      // Restore original fog on cleanup
      if (originalFogRef.current !== null) {
        scene.fog = originalFogRef.current;
      }
    };
  }, [scene]);
  
  /**
   * Apply underwater camera effect
   */
  const setUnderwaterEffect = useCallback((underwater: boolean) => {
    if (underwater) {
      // Store original fog if not already stored
      if (originalFogRef.current === null && scene.fog !== underwaterFogRef.current) {
        originalFogRef.current = scene.fog;
      }
      scene.fog = underwaterFogRef.current;
    } else {
      // Restore original fog
      if (originalFogRef.current !== null) {
        scene.fog = originalFogRef.current;
      }
    }
  }, [scene]);
  
  /**
   * Update water physics - call this every frame with player position
   * Returns modified velocity for underwater movement
   */
  const updateWaterPhysics = useCallback((
    cameraPosition: THREE.Vector3,
    velocity: THREE.Vector3,
    isJumping: boolean,
    dt: number
  ): { velocity: THREE.Vector3; onGround: boolean; preventNormalPhysics: boolean } => {
    if (!enabled) {
      return { velocity, onGround: false, preventNormalPhysics: false };
    }
    
    const playerFeetY = cameraPosition.y - 1.6; // Assuming standing height
    const wasSubmerged = isSubmergedRef.current;
    const isNowSubmerged = isInPool(cameraPosition.x, playerFeetY, cameraPosition.z);
    const atSurface = isAtSurface(cameraPosition.x, playerFeetY, cameraPosition.z);
    
    // Update submersion state
    if (isNowSubmerged !== wasSubmerged) {
      isSubmergedRef.current = isNowSubmerged;
      setUnderwaterEffect(isNowSubmerged);
      
      // Notify state change
      onStateChange?.({
        isSubmerged: isNowSubmerged,
        oxygen: oxygenRef.current,
        maxOxygen: POOL_CONFIG.maxOxygen,
      });
    }
    
    if (isNowSubmerged) {
      // Underwater physics
      const modifiedVelocity = velocity.clone();
      
      // Apply water drag to horizontal movement
      modifiedVelocity.x *= POOL_CONFIG.swimDrag;
      modifiedVelocity.z *= POOL_CONFIG.swimDrag;
      
      if (isJumping) {
        // Slow upward propulsion when jumping
        modifiedVelocity.y = POOL_CONFIG.jumpBoost;
      } else {
        // Sink when not jumping
        modifiedVelocity.y = -POOL_CONFIG.sinkSpeed;
      }
      
      // Clamp to pool floor
      const poolFloorY = -POOL_CONFIG.depth + 1.6; // Feet at floor + player height
      if (cameraPosition.y + modifiedVelocity.y * dt < poolFloorY) {
        modifiedVelocity.y = 0;
        cameraPosition.y = poolFloorY;
      }
      
      // Oxygen depletion
      oxygenRef.current -= dt;
      
      // Damage when out of oxygen
      if (oxygenRef.current <= 0) {
        oxygenRef.current = 0;
        const now = performance.now();
        // Deal damage every second
        if (now - lastDamageTimeRef.current > 1000) {
          onDamage?.(POOL_CONFIG.oxygenDamageRate);
          lastDamageTimeRef.current = now;
        }
      }
      
      // Notify state change for oxygen updates
      onStateChange?.({
        isSubmerged: true,
        oxygen: oxygenRef.current,
        maxOxygen: POOL_CONFIG.maxOxygen,
      });
      
      return {
        velocity: modifiedVelocity,
        onGround: false, // Never on ground when underwater
        preventNormalPhysics: true,
      };
    } else {
      // Above water - recover oxygen
      if (oxygenRef.current < POOL_CONFIG.maxOxygen) {
        const recoveryRate = POOL_CONFIG.maxOxygen / POOL_CONFIG.oxygenRecoveryRate;
        oxygenRef.current = Math.min(
          POOL_CONFIG.maxOxygen,
          oxygenRef.current + recoveryRate * dt
        );
        
        // Notify state change for oxygen recovery
        onStateChange?.({
          isSubmerged: false,
          oxygen: oxygenRef.current,
          maxOxygen: POOL_CONFIG.maxOxygen,
        });
      }
      
      return { velocity, onGround: false, preventNormalPhysics: false };
    }
  }, [enabled, onDamage, onStateChange, setUnderwaterEffect]);
  
  /**
   * Reset oxygen to full (e.g., on respawn)
   */
  const resetOxygen = useCallback(() => {
    oxygenRef.current = POOL_CONFIG.maxOxygen;
    isSubmergedRef.current = false;
    setUnderwaterEffect(false);
  }, [setUnderwaterEffect]);
  
  return {
    updateWaterPhysics,
    resetOxygen,
    isSubmergedRef,
    oxygenRef,
  };
}
