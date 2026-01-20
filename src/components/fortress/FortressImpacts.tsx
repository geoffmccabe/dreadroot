// Bullet impact fire effects using three-particle-fire
// 7-fire hex pattern: 1 center fire + 6 surrounding fires in hex arrangement
// Uses BulletDefinitions context for size/duration/colors

import { forwardRef, useImperativeHandle, useRef, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import particleFire from 'three-particle-fire';

// Install with our THREE instance
particleFire.install({ THREE });

// Maximum concurrent impact effect groups
const MAX_IMPACT_GROUPS = 15;
const PARTICLE_COUNT_CENTER = 80;
const PARTICLE_COUNT_OUTER = 40;

export interface ImpactConfig {
  colors?: string[];      // Up to 3 colors for the hex pattern
  size?: number;          // Diameter of the hex pattern
  duration?: number;      // Duration in seconds
  height?: number;        // Height of center fire
  tier?: number;
}

export interface BulletImpactsHandle {
  spawnImpact: (position: THREE.Vector3, config?: ImpactConfig) => void;
}

interface FireInstance {
  points: THREE.Points;
  material: any;
  startTime: number;
  duration: number;
}

interface ImpactGroup {
  fires: FireInstance[];
  startTime: number;
}

// Convert hex color to THREE.Color number
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// Get hex positions around center (6 points at 60° intervals)
function getHexOffsets(diameter: number): THREE.Vector2[] {
  const radius = diameter / 2;
  const offsets: THREE.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3; // 60° intervals
    offsets.push(new THREE.Vector2(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    ));
  }
  return offsets;
}

export const BulletImpacts = forwardRef<BulletImpactsHandle, {}>((_, ref) => {
  const { scene, camera } = useThree();
  const activeGroupsRef = useRef<ImpactGroup[]>([]);

  const spawnImpact = useCallback((position: THREE.Vector3, config?: ImpactConfig) => {
    // Get colors - fill missing with first color
    const inputColors = config?.colors ?? ['#FFFF00'];
    const color1 = inputColors[0] || '#FFFF00';
    const color2 = inputColors[1] || color1;
    const color3 = inputColors[2] || color1;
    
    // Get dimensions from config
    const userWidth = config?.size ?? 0.5;
    const userHeight = config?.height ?? 1.0;
    const userDuration = config?.duration ?? 0.5;
    
    // Calculate actual sizes based on user's design spec
    const centerWidth = userWidth * 0.5;
    const outerWidth = userWidth * 0.3;
    const centerHeight = userHeight;
    const outerHeightA = userHeight * 0.4; // First set of 3
    const outerHeightB = userHeight * 0.6; // Second set of 3
    
    const centerDuration = userDuration * 1000;
    const outerDuration = userDuration * 0.8 * 1000;
    
    // Hex offsets for the 6 outer fires
    const hexOffsets = getHexOffsets(userWidth);

    // Remove oldest group if at limit
    if (activeGroupsRef.current.length >= MAX_IMPACT_GROUPS) {
      const oldest = activeGroupsRef.current.shift();
      if (oldest) {
        oldest.fires.forEach(fire => {
          scene.remove(fire.points);
          fire.points.geometry.dispose();
          fire.material.dispose();
        });
      }
    }

    const fires: FireInstance[] = [];
    const now = performance.now();

    // Helper to create a fire instance
    const createFire = (
      pos: THREE.Vector3,
      color: string,
      width: number,
      height: number,
      duration: number,
      particleCount: number
    ): FireInstance => {
      const radius = width / 2;
      const geometry = new particleFire.Geometry(radius, height, particleCount);
      const material = new particleFire.Material({ color: hexToNumber(color) });
      
      // Fix grey fringe: use additive blending and disable depth write
      material.blending = THREE.AdditiveBlending;
      material.depthWrite = false;
      material.transparent = true;
      
      if (camera instanceof THREE.PerspectiveCamera) {
        material.setPerspective(camera.fov, window.innerHeight);
      }

      const firePoints = new THREE.Points(geometry, material);
      firePoints.position.copy(pos);
      scene.add(firePoints);

      return {
        points: firePoints,
        material,
        startTime: now,
        duration,
      };
    };

    // 1. Center fire (color 1, full height, full duration)
    fires.push(createFire(
      position.clone(),
      color1,
      centerWidth,
      centerHeight,
      centerDuration,
      PARTICLE_COUNT_CENTER
    ));

    // 2. First set of 3 outer fires (color 2, positions 0, 2, 4 in hex)
    [0, 2, 4].forEach(i => {
      const offset = hexOffsets[i];
      const pos = position.clone().add(new THREE.Vector3(offset.x, 0, offset.y));
      fires.push(createFire(pos, color2, outerWidth, outerHeightA, outerDuration, PARTICLE_COUNT_OUTER));
    });

    // 3. Second set of 3 outer fires (color 3, positions 1, 3, 5 in hex)
    [1, 3, 5].forEach(i => {
      const offset = hexOffsets[i];
      const pos = position.clone().add(new THREE.Vector3(offset.x, 0, offset.y));
      fires.push(createFire(pos, color3, outerWidth, outerHeightB, outerDuration, PARTICLE_COUNT_OUTER));
    });

    activeGroupsRef.current.push({
      fires,
      startTime: now,
    });
  }, [scene, camera]);

  useImperativeHandle(ref, () => ({ spawnImpact }), [spawnImpact]);

  // Update all fires and clean up expired ones
  useFrame((state, delta) => {
    const now = performance.now();
    const groupsToRemove: number[] = [];

    for (let g = 0; g < activeGroupsRef.current.length; g++) {
      const group = activeGroupsRef.current[g];
      let allExpired = true;
      const firesToRemove: number[] = [];

      for (let f = 0; f < group.fires.length; f++) {
        const fire = group.fires[f];
        const elapsed = now - fire.startTime;

        if (elapsed > fire.duration) {
          // Fire expired
          scene.remove(fire.points);
          fire.points.geometry.dispose();
          fire.material.dispose();
          firesToRemove.push(f);
        } else {
          allExpired = false;
          // Update animation
          fire.material.update(delta);
          
          // Fade out in last 20%
          const remaining = 1 - (elapsed / fire.duration);
          if (remaining < 0.2) {
            fire.material.opacity = remaining / 0.2;
          }
        }
      }

      // Remove expired fires from group (reverse order)
      for (let i = firesToRemove.length - 1; i >= 0; i--) {
        group.fires.splice(firesToRemove[i], 1);
      }

      if (allExpired) {
        groupsToRemove.push(g);
      }
    }

    // Remove empty groups (reverse order)
    for (let i = groupsToRemove.length - 1; i >= 0; i--) {
      activeGroupsRef.current.splice(groupsToRemove[i], 1);
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeGroupsRef.current.forEach(group => {
        group.fires.forEach(fire => {
          scene.remove(fire.points);
          fire.points.geometry.dispose();
          fire.material.dispose();
        });
      });
      activeGroupsRef.current = [];
    };
  }, [scene]);

  return null;
});

BulletImpacts.displayName = 'BulletImpacts';
