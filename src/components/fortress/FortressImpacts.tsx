// Bullet impact fire effects using three-particle-fire
// Lightweight GPU-accelerated fire using THREE.Points
// Size/duration from BulletDefinitions context
// Multi-color support: blends colors for performance

import { forwardRef, useImperativeHandle, useRef, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import particleFire from 'three-particle-fire';

// Install with our THREE instance
particleFire.install({ THREE });

// Maximum concurrent impact effects
const MAX_IMPACTS = 25;

// Fallback base values if no definition found
const BASE_SIZE = 0.25;
const BASE_DURATION = 0.5;
const PARTICLE_COUNT = 80;

export interface ImpactConfig {
  colors?: string[];      // Multiple colors to blend
  color?: string;         // Single color fallback
  size?: number;          // Override size
  duration?: number;      // Override duration (seconds)
  height?: number;        // Override height multiplier
  tier?: number;
}

export interface BulletImpactsHandle {
  spawnImpact: (position: THREE.Vector3, config?: ImpactConfig) => void;
}

interface ActiveImpact {
  points: THREE.Points;
  material: any; // particleFire.Material
  startTime: number;
  duration: number;
}

// Blend multiple hex colors into one averaged color (FPS-friendly)
function blendColors(colors: string[]): string {
  if (colors.length === 0) return '#FFFF00';
  if (colors.length === 1) return colors[0];
  
  let r = 0, g = 0, b = 0;
  for (const hex of colors) {
    const cleaned = hex.replace('#', '');
    r += parseInt(cleaned.substring(0, 2), 16);
    g += parseInt(cleaned.substring(2, 4), 16);
    b += parseInt(cleaned.substring(4, 6), 16);
  }
  
  const count = colors.length;
  return `#${Math.round(r / count).toString(16).padStart(2, '0')}${Math.round(g / count).toString(16).padStart(2, '0')}${Math.round(b / count).toString(16).padStart(2, '0')}`;
}

// Convert hex color to THREE.Color number
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export const BulletImpacts = forwardRef<BulletImpactsHandle, {}>((_, ref) => {
  const { scene, camera } = useThree();
  const activeImpactsRef = useRef<ActiveImpact[]>([]);
  const perspectiveSetRef = useRef(false);

  // Spawn an impact effect at position
  const spawnImpact = useCallback((position: THREE.Vector3, config?: ImpactConfig) => {
    const tier = config?.tier ?? 1;
    
    // Blend multiple colors or use single color
    const colors = config?.colors ?? (config?.color ? [config.color] : ['#FFFF00']);
    const blendedColor = blendColors(colors);
    
    // Use provided values or calculate from tier
    const tierMultiplier = 1 + (tier - 1) * 0.1;
    const size = config?.size ?? (BASE_SIZE * tierMultiplier);
    const durationSec = config?.duration ?? (BASE_DURATION * tierMultiplier);
    const duration = durationSec * 1000; // Convert to ms
    const heightMultiplier = config?.height ?? 1.5;

    // Remove oldest impact if at limit
    if (activeImpactsRef.current.length >= MAX_IMPACTS) {
      const oldest = activeImpactsRef.current.shift();
      if (oldest) {
        scene.remove(oldest.points);
        oldest.points.geometry.dispose();
        oldest.material.dispose();
      }
    }

    // Create fire geometry and material
    const radius = size / 2;
    const height = size * heightMultiplier;
    
    const geometry = new particleFire.Geometry(radius, height, PARTICLE_COUNT);
    const material = new particleFire.Material({ color: hexToNumber(blendedColor) });
    
    // Set perspective for proper point sizing
    if (camera instanceof THREE.PerspectiveCamera) {
      material.setPerspective(camera.fov, window.innerHeight);
    }

    const firePoints = new THREE.Points(geometry, material);
    firePoints.position.copy(position);
    scene.add(firePoints);

    activeImpactsRef.current.push({
      points: firePoints,
      material,
      startTime: performance.now(),
      duration,
    });
  }, [scene, camera]);

  useImperativeHandle(ref, () => ({ spawnImpact }), [spawnImpact]);

  // Update all fires and clean up expired ones
  useFrame((state, delta) => {
    const now = performance.now();
    const toRemove: number[] = [];

    for (let i = 0; i < activeImpactsRef.current.length; i++) {
      const impact = activeImpactsRef.current[i];
      const elapsed = now - impact.startTime;

      if (elapsed > impact.duration) {
        // Time's up - remove
        scene.remove(impact.points);
        impact.points.geometry.dispose();
        impact.material.dispose();
        toRemove.push(i);
      } else {
        // Still active - update animation
        impact.material.update(delta);
        
        // Fade out in the last 20% of duration
        const remaining = 1 - (elapsed / impact.duration);
        if (remaining < 0.2) {
          impact.material.opacity = remaining / 0.2;
        }
      }
    }

    // Remove expired (reverse order to maintain indices)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      activeImpactsRef.current.splice(toRemove[i], 1);
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeImpactsRef.current.forEach(impact => {
        scene.remove(impact.points);
        impact.points.geometry.dispose();
        impact.material.dispose();
      });
      activeImpactsRef.current = [];
    };
  }, [scene]);

  return null;
});

BulletImpacts.displayName = 'BulletImpacts';
