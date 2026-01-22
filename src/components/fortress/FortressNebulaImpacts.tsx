// Bullet impact effects using three-nebula (proper alpha transparency)
// Alternative to FortressImpacts.tsx (three-particle-fire) for sky-friendly rendering

import { forwardRef, useImperativeHandle, useRef, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import System, { SpriteRenderer, Emitter, Rate, Span, Position, Mass, Life, Radius, RadialVelocity, Alpha, Scale, Color, Force, RandomDrift, Vector3D } from 'three-nebula';

// Debug flag
const DEBUG_NEBULA_IMPACTS = false;

// Maximum concurrent impact effects
const MAX_IMPACTS = 20;

// Soft circle particle texture with proper alpha (32x32 radial gradient)
const PARTICLE_TEXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABhElEQVRYhe2XMU7DQBBF3yxJgUQBHIAChyAFR+AIdJQcgTJH4AiUFBQcgQo4AFQUSHSAEE9hs9mNvWs7WSt8aSXH8s78P7OzHsMSIYRO+3mC0EEfUEZZ4AR4AO6AZeBU0p2kK0lXkm4k9SXdSrqU1JXUkXQhqS3pVNJJ+v6ppPbY+fOkAXQD9QQ+gDfgFbgGPiW9J5f3AG8I4QhYAjaAFWAT2ALWgXVgDegBC8ACMAcMgAHwDvSBt+SDEQEuJaX/bwBngCPgEPgBnoDH+G0DeDYzAYaBzd8HzA+QdA7MAJ9AV1IP+AAeg1APYAD0g9ADsA9sA9vx6raBDeC7xGS2FPgBnkfEFfAN3AMPIb6dgILXDCH0U+vQJFZ5BXwAzwN8l4TQ97j2gGP+/zJLMCk+TwJrgIVhO/H5JbACZJZlrBBCr4lwlkUYSf8bDWAROGRYc1Q4LwCWGW4zXWCO4d7xJnAS4usB+yGE/hjfJL+LawC1B2B5FPgVxw+B5VL/Pxd/AVKPNJWYuG0QAAAAAElFTkSuQmCC';

export interface NebulaImpactConfig {
  colors?: string[];      // Up to 3 colors for the effect
  size?: number;          // Diameter of the effect
  duration?: number;      // Duration in seconds
  height?: number;        // Height of fire column
  tier?: number;
}

export interface NebulaImpactsHandle {
  spawnImpact: (position: THREE.Vector3, config?: NebulaImpactConfig) => void;
}

interface ActiveImpact {
  emitter: Emitter;
  startTime: number;
  duration: number;
}

// Helper to convert hex to THREE.Color
function hexToThreeColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export const NebulaImpacts = forwardRef<NebulaImpactsHandle, {}>((_, ref) => {
  const { scene } = useThree();
  const systemRef = useRef<System | null>(null);
  const rendererRef = useRef<SpriteRenderer | null>(null);
  const activeImpactsRef = useRef<ActiveImpact[]>([]);
  const textureRef = useRef<THREE.Texture | null>(null);

  // Initialize system
  useEffect(() => {
    // Load texture
    const loader = new THREE.TextureLoader();
    loader.load(PARTICLE_TEXTURE, (texture) => {
      textureRef.current = texture;
    });

    // Create system with custom renderer for proper blending
    const system = new System();
    const renderer = new SpriteRenderer(scene, THREE);
    system.addRenderer(renderer);
    
    systemRef.current = system;
    rendererRef.current = renderer;
    
    if (DEBUG_NEBULA_IMPACTS) {
      console.log('[NebulaImpacts] System initialized');
    }

    return () => {
      system.destroy();
      textureRef.current?.dispose();
    };
  }, [scene]);

  const spawnImpact = useCallback((position: THREE.Vector3, config?: NebulaImpactConfig) => {
    const system = systemRef.current;
    if (!system) return;

    // Remove oldest if at limit
    if (activeImpactsRef.current.length >= MAX_IMPACTS) {
      const oldest = activeImpactsRef.current.shift();
      if (oldest) {
        system.removeEmitter(oldest.emitter);
        oldest.emitter.destroy();
      }
    }

    // Get config values
    const colors = config?.colors ?? ['#FFAA00', '#FF6600', '#FF3300'];
    const size = config?.size ?? 0.5;
    const duration = (config?.duration ?? 0.5) * 1000;
    const height = config?.height ?? 1.0;

    const color1 = colors[0] || '#FFAA00';
    const color2 = colors[1] || colors[0] || '#FF6600';

    if (DEBUG_NEBULA_IMPACTS) {
      console.log('[NebulaImpacts] Spawning at', position.toArray(), { size, height, duration, colors });
    }

    // Create emitter with one-shot burst
    const emitter = new Emitter();
    
    emitter
      .setRate(new Rate(new Span(15, 25), new Span(0.001, 0.001))) // One-shot burst
      .setInitializers([
        new Mass(0.5, 1),
        new Life(0.15 * (duration / 500), 0.4 * (duration / 500)),
        new Radius(size * 0.06, size * 0.15),
        new Position(new Vector3D(0, 0, 0)),
        new RadialVelocity(height * 2, new Vector3D(0, 1, 0), 60),
      ])
      .setBehaviours([
        new Alpha(1, 0),
        new Scale(1.2, 0.1),
        new Color(hexToThreeColor(color1), hexToThreeColor(color2)),
        new Force(0, height * 1.5, 0),
        new RandomDrift(size * 0.6, size * 0.3, size * 0.6, 0.02),
      ])
      .setPosition(position)
      .emit(1); // Emit once

    system.addEmitter(emitter);

    activeImpactsRef.current.push({
      emitter,
      startTime: performance.now(),
      duration,
    });
  }, []);

  useImperativeHandle(ref, () => ({ spawnImpact }), [spawnImpact]);

  // Update system and clean up expired emitters
  useFrame((_, delta) => {
    const system = systemRef.current;
    if (!system) return;

    system.update(delta);

    // Clean up expired impacts
    const now = performance.now();
    const toRemove: number[] = [];

    for (let i = 0; i < activeImpactsRef.current.length; i++) {
      const impact = activeImpactsRef.current[i];
      if (now - impact.startTime > impact.duration + 500) { // Extra buffer for particle fade
        system.removeEmitter(impact.emitter);
        impact.emitter.destroy();
        toRemove.push(i);
      }
    }

    // Remove in reverse order
    for (let i = toRemove.length - 1; i >= 0; i--) {
      activeImpactsRef.current.splice(toRemove[i], 1);
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const system = systemRef.current;
      if (system) {
        activeImpactsRef.current.forEach(impact => {
          system.removeEmitter(impact.emitter);
          impact.emitter.destroy();
        });
        activeImpactsRef.current = [];
      }
    };
  }, []);

  return null;
});

NebulaImpacts.displayName = 'NebulaImpacts';
