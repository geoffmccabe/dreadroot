// Bullet impact effects using three-nebula (proper alpha transparency)
// Alternative to FortressImpacts.tsx (three-particle-fire) for sky-friendly rendering

import { forwardRef, useImperativeHandle, useRef, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import System, { SpriteRenderer, Emitter, Rate, Span, Position, Mass, Life, Radius, RadialVelocity, Alpha, Scale, Color, Force, RandomDrift, Vector3D, PointZone } from 'three-nebula';

// Custom Body initializer that follows three-nebula's expected interface
// Must have initialize() method - three-nebula calls this for each particle
function createBodyInitializer(sprite: THREE.Sprite) {
  return {
    type: 'Body',
    isEnabled: true,
    reset() {},
    init() {}, // Called once when added to emitter - no-op for us
    initialize(particle: any) {
      particle.body = sprite.clone();
    }
  };
}

// Debug flag
const DEBUG_NEBULA_IMPACTS = true;

// Maximum concurrent impact effects
const MAX_IMPACTS = 20;

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

// Create a shared sprite for all particles (more efficient)
function createParticleSprite(): THREE.Sprite {
  // Create a simple radial gradient texture programmatically
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  
  // Radial gradient from white center to transparent edge
  const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  
  return new THREE.Sprite(material);
}

export const NebulaImpacts = forwardRef<NebulaImpactsHandle, {}>((_, ref) => {
  const { scene } = useThree();
  const systemRef = useRef<System | null>(null);
  const rendererRef = useRef<SpriteRenderer | null>(null);
  const activeImpactsRef = useRef<ActiveImpact[]>([]);
  const sharedSpriteRef = useRef<THREE.Sprite | null>(null);

  // Initialize system
  useEffect(() => {
    // Create shared sprite once
    sharedSpriteRef.current = createParticleSprite();
    
    // Create system with custom renderer for proper blending
    const system = new System();
    const renderer = new SpriteRenderer(scene, THREE);
    system.addRenderer(renderer);
    
    systemRef.current = system;
    rendererRef.current = renderer;
    
    if (DEBUG_NEBULA_IMPACTS) {
      console.log('[NebulaImpacts] System initialized with shared sprite');
    }

    return () => {
      system.destroy();
      if (sharedSpriteRef.current) {
        sharedSpriteRef.current.material.dispose();
        if ((sharedSpriteRef.current.material as THREE.SpriteMaterial).map) {
          (sharedSpriteRef.current.material as THREE.SpriteMaterial).map!.dispose();
        }
      }
    };
  }, [scene]);

  const spawnImpact = useCallback((position: THREE.Vector3, config?: NebulaImpactConfig) => {
    const system = systemRef.current;
    const sharedSprite = sharedSpriteRef.current;
    
    if (!system || !sharedSprite) {
      if (DEBUG_NEBULA_IMPACTS) {
        console.warn('[NebulaImpacts] System or sprite not ready');
      }
      return;
    }

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

    try {
      // Create emitter with one-shot burst
      const emitter = new Emitter();
      
      emitter
        .setRate(new Rate(new Span(15, 25), new Span(0.001, 0.001))) // One-shot burst
        .setInitializers([
          createBodyInitializer(sharedSprite),
          new Mass(0.5, 1),
          new Life(0.15 * (duration / 500), 0.4 * (duration / 500)),
          new Radius(size * 0.06, size * 0.15),
          new Position(new PointZone(0, 0, 0)),
          new RadialVelocity(height * 2, new Vector3D(0, 1, 0), 60),
        ])
        .setBehaviours([
          new Alpha(1, 0),
          new Scale(1.2, 0.1),
          new Color(hexToThreeColor(color1), hexToThreeColor(color2)),
          new Force(0, height * 1.5, 0),
          new RandomDrift(size * 0.6, size * 0.3, size * 0.6, 0.02),
        ])
        .setPosition({ x: position.x, y: position.y, z: position.z })
        .emit(1); // Emit once

      system.addEmitter(emitter);

      activeImpactsRef.current.push({
        emitter,
        startTime: performance.now(),
        duration,
      });
    } catch (error) {
      console.error('[NebulaImpacts] Failed to create emitter:', error);
    }
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
