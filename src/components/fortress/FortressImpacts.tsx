// Bullet impact fire effects using three-nebula
// Uses the fire preset scaled for bullet impacts
// 0.25m diameter for T1, scales with tier
// 0.5s duration for T1, scales with tier
// Color matches bullet color

import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import System, { SpriteRenderer } from 'three-nebula';
import * as THREE from 'three';

// Maximum concurrent impact effects
const MAX_IMPACTS = 20;

// Base values for T1
const BASE_SIZE = 0.25; // 0.25m diameter for T1
const BASE_DURATION = 0.5; // 0.5 seconds for T1

// Particle texture - transparent soft circle (same as in presets.ts)
const PARTICLE_TEXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABhElEQVRYhe2XMU7DQBBF3yxJgUQBHIAChyAFR+AIdJQcgTJH4AiUFBQcgQo4AFQUSHSAEE9hs9mNvWs7WSt8aSXH8s78P7OzHsMSIYRO+3mC0EEfUEZZ4AR4AO6AZeBU0p2kK0lXkm4k9SXdSrqU1JXUkXQhqS3pVNJJ+v6ppPbY+fOkAXQD9QQ+gDfgFbgGPiW9J5f3AG8I4QhYAjaAFWAT2ALWgXVgDegBC8ACMAcMgAHwDvSBt+SDEQEuJaX/bwBngCPgEPgBnoDH+G0DeDYzAYaBzd8HzA+QdA7MAJ9AV1IP+AAeg1APYAD0g9ADsA9sA9vx6raBDeC7xGS2FPgBnkfEFfAN3AMPIb6dgILXDCH0U+vQJFZ5BXwAzwN8l4TQ97j2gGP+/zJLMCk+TwJrgIVhO/H5JbACZJZlrBBCr4lwlkUYSf8bDWAROGRYc1Q4LwCWGW4zXWCO4d7xJnAS4usB+yGE/hjfJL+LawC1B2B5FPgVxw+B5VL/Pxd/AVKPNJWYuG0QAAAAAElFTkSuQmCC';

export interface ImpactConfig {
  color?: string;   // Hex color for the impact (default: yellow)
  size?: number;    // Override size in meters
  tier?: number;    // Bullet tier for scaling (default: 1, adds 10% per tier)
}

export interface BulletImpactsHandle {
  spawnImpact: (position: THREE.Vector3, config?: ImpactConfig) => void;
}

interface ActiveImpact {
  system: System;
  startTime: number;
  duration: number;
}

// Darken a hex color for the fire fade (shift toward red/orange)
function darkenColor(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  
  // Shift towards red/orange and darken
  const newR = Math.min(255, Math.floor(r * 0.9));
  const newG = Math.floor(g * 0.3);
  const newB = Math.floor(b * 0.1);
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// Create fire burst preset for bullet impact
function createImpactPreset(
  position: THREE.Vector3,
  size: number,
  duration: number,
  color: string
) {
  const startColor = color;
  const endColor = darkenColor(color);
  
  // Scale radius based on size (0.25m diameter = particles up to ~0.125m radius)
  const radiusMin = size * 0.15;
  const radiusMax = size * 0.4;
  
  // Life duration for individual particles
  const lifeMin = duration * 0.4;
  const lifeMax = duration * 0.9;
  
  return {
    preParticles: 25,
    integrationType: 'EULER',
    emitters: [
      {
        // One-shot burst - emit all particles immediately
        rate: { particlesMin: 18, particlesMax: 25, perSecondMin: 0.001, perSecondMax: 0.001 },
        position: { x: position.x, y: position.y, z: position.z },
        initializers: [
          { type: 'Mass', properties: { min: 0.5, max: 1, isEnabled: true } },
          { type: 'Life', properties: { min: lifeMin, max: lifeMax, isEnabled: true } },
          { type: 'BodySprite', properties: { texture: PARTICLE_TEXTURE, isEnabled: true } },
          { type: 'Radius', properties: { min: radiusMin, max: radiusMax, isEnabled: true } },
          { type: 'RadialVelocity', properties: { radius: 2.5, x: 0, y: 1, z: 0, theta: 55, isEnabled: true } },
        ],
        behaviours: [
          { type: 'Alpha', properties: { alphaA: 1, alphaB: 0, life: null, easing: 'easeOutCubic' } },
          { type: 'Color', properties: { colorA: startColor, colorB: endColor, life: null, easing: 'easeLinear' } },
          { type: 'Scale', properties: { scaleA: 1.2, scaleB: 0.05, life: null, easing: 'easeOutCubic' } },
          { type: 'Force', properties: { fx: 0, fy: 1.8, fz: 0, life: null, easing: 'easeLinear' } },
          { type: 'RandomDrift', properties: { driftX: 0.5, driftY: 0.25, driftZ: 0.5, delay: 0, life: null, easing: 'easeLinear' } },
        ],
      },
    ],
  };
}

export const BulletImpacts = forwardRef<BulletImpactsHandle, {}>((_, ref) => {
  const { scene } = useThree();
  const activeImpactsRef = useRef<ActiveImpact[]>([]);
  const rendererRef = useRef<SpriteRenderer | null>(null);

  // Spawn an impact effect at position
  const spawnImpact = useCallback(async (position: THREE.Vector3, config?: ImpactConfig) => {
    const tier = config?.tier ?? 1;
    const color = config?.color ?? '#FFFF00'; // Yellow for T1
    
    // Scale size and duration by tier (10% increase per tier)
    const tierMultiplier = 1 + (tier - 1) * 0.1;
    const size = config?.size ?? (BASE_SIZE * tierMultiplier);
    const duration = BASE_DURATION * tierMultiplier;

    // Remove oldest impact if at limit
    if (activeImpactsRef.current.length >= MAX_IMPACTS) {
      const oldest = activeImpactsRef.current.shift();
      if (oldest) {
        // Force cleanup all particles
        oldest.system.emitters.forEach((emitter: any) => {
          emitter.stopEmit();
          emitter.particles.length = 0;
        });
        oldest.system.destroy();
      }
    }

    try {
      // Create renderer if needed
      if (!rendererRef.current) {
        rendererRef.current = new SpriteRenderer(scene, THREE);
      }

      const preset = createImpactPreset(position, size, duration, color);
      const system = await System.fromJSONAsync(preset, THREE);
      system.addRenderer(rendererRef.current);

      activeImpactsRef.current.push({
        system,
        startTime: performance.now(),
        duration: duration * 1000, // Convert to ms
      });
    } catch (error) {
      console.error('[BulletImpacts] Failed to spawn impact:', error);
    }
  }, [scene]);

  useImperativeHandle(ref, () => ({ spawnImpact }), [spawnImpact]);

  // Update all active systems and clean up expired ones
  useFrame((_, delta) => {
    const now = performance.now();
    const toRemove: number[] = [];

    for (let i = 0; i < activeImpactsRef.current.length; i++) {
      const impact = activeImpactsRef.current[i];
      const elapsed = now - impact.startTime;

      if (elapsed > impact.duration) {
        // Time's up - destroy completely, clear all particles
        impact.system.emitters.forEach((emitter: any) => {
          emitter.stopEmit();
          // Force clear particle arrays to prevent last-frame persistence
          emitter.particles.length = 0;
          emitter.pool.list.length = 0;
        });
        impact.system.destroy();
        toRemove.push(i);
      } else {
        // Still active - update
        impact.system.update(delta);
      }
    }

    // Remove expired impacts (reverse order to maintain indices)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      activeImpactsRef.current.splice(toRemove[i], 1);
    }
  });

  return null;
});

BulletImpacts.displayName = 'BulletImpacts';
