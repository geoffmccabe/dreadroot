// Bullet impact effects component
// Manages fire-like impact effects when bullets hit blocks

import React, { useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import System, { SpriteRenderer } from 'three-nebula';
import * as THREE from 'three';
import { impactPreset } from '@/features/particles/presets';

// Maximum concurrent impact effects
const MAX_IMPACTS = 10;

// Default impact configuration
const DEFAULT_IMPACT_COLOR = '#FFAA00'; // Yellow/orange
const DEFAULT_IMPACT_SIZE = 1.0; // 1 meter (block width)
const DEFAULT_IMPACT_DURATION = 1000; // 1 second in ms

export interface ImpactConfig {
  color?: string; // Hex color (e.g., '#FFAA00')
  size?: number; // Size multiplier (1.0 = block width)
}

export interface BulletImpactsHandle {
  spawnImpact: (position: THREE.Vector3, config?: ImpactConfig) => void;
}

interface ActiveImpact {
  emitter: any;
  startTime: number;
  duration: number;
}

export const BulletImpacts = forwardRef<BulletImpactsHandle, {}>((_, ref) => {
  const { scene } = useThree();
  const systemRef = useRef<System | null>(null);
  const rendererRef = useRef<SpriteRenderer | null>(null);
  const activeImpactsRef = useRef<ActiveImpact[]>([]);
  const initializedRef = useRef(false);

  // Initialize the particle system once
  const ensureInitialized = useCallback(async () => {
    if (initializedRef.current && systemRef.current) return;
    
    try {
      const system = new System();
      const renderer = new SpriteRenderer(scene, THREE);
      system.addRenderer(renderer);
      systemRef.current = system;
      rendererRef.current = renderer;
      initializedRef.current = true;
    } catch (error) {
      console.error('[BulletImpacts] Failed to initialize:', error);
    }
  }, [scene]);

  // Spawn an impact effect at position
  const spawnImpact = useCallback(async (position: THREE.Vector3, config?: ImpactConfig) => {
    await ensureInitialized();
    
    const system = systemRef.current;
    if (!system) return;
    
    // Limit concurrent impacts
    if (activeImpactsRef.current.length >= MAX_IMPACTS) {
      // Remove oldest impact
      const oldest = activeImpactsRef.current.shift();
      if (oldest?.emitter) {
        system.removeEmitter(oldest.emitter);
        oldest.emitter.destroy();
      }
    }
    
    const color = config?.color || DEFAULT_IMPACT_COLOR;
    const size = config?.size || DEFAULT_IMPACT_SIZE;
    
    // Parse the color to get start/end gradient
    const startColor = color;
    const endColor = darkenColor(color, 0.4); // Darken for gradient
    
    // Create a modified preset with custom position, color, and size
    const modifiedPreset = {
      ...impactPreset,
      emitters: impactPreset.emitters.map(emitter => ({
        ...emitter,
        position: { x: position.x, y: position.y, z: position.z },
        initializers: emitter.initializers.map((init: any) => {
          if (init.type === 'Radius') {
            return {
              ...init,
              properties: {
                ...init.properties,
                min: init.properties.min * size,
                max: init.properties.max * size,
              },
            };
          }
          return init;
        }),
        behaviours: emitter.behaviours.map((behaviour: any) => {
          if (behaviour.type === 'Color') {
            return {
              ...behaviour,
              properties: {
                ...behaviour.properties,
                colorA: startColor,
                colorB: endColor,
              },
            };
          }
          return behaviour;
        }),
      })),
    };

    try {
      // Load the preset and add emitters to our system
      const loadedSystem = await System.fromJSONAsync(modifiedPreset, THREE);
      
      loadedSystem.emitters.forEach((emitter: any) => {
        system.addEmitter(emitter);
        activeImpactsRef.current.push({
          emitter,
          startTime: performance.now(),
          duration: DEFAULT_IMPACT_DURATION,
        });
      });
    } catch (error) {
      console.error('[BulletImpacts] Failed to spawn impact:', error);
    }
  }, [ensureInitialized]);

  // Expose the spawnImpact function
  useImperativeHandle(ref, () => ({
    spawnImpact,
  }), [spawnImpact]);

  // Update particles and clean up expired impacts
  useFrame((_, delta) => {
    const system = systemRef.current;
    if (!system) return;
    
    system.update(delta);
    
    // Clean up expired impacts
    const now = performance.now();
    const active = activeImpactsRef.current;
    
    for (let i = active.length - 1; i >= 0; i--) {
      const impact = active[i];
      if (now - impact.startTime > impact.duration) {
        system.removeEmitter(impact.emitter);
        impact.emitter.destroy();
        active.splice(i, 1);
      }
    }
  });

  return null;
});

BulletImpacts.displayName = 'BulletImpacts';

// Helper to darken a hex color
function darkenColor(hex: string, factor: number): string {
  // Remove # if present
  const cleanHex = hex.replace('#', '');
  
  // Parse RGB
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  
  // Darken
  const newR = Math.round(r * (1 - factor));
  const newG = Math.round(g * (1 - factor));
  const newB = Math.round(b * (1 - factor));
  
  // Convert back to hex
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}
