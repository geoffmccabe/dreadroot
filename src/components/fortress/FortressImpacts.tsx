// Bullet impact fire effects using three-nebula
// Uses a single shared System with on-demand emitters
// 0.25m diameter for T1, scales with tier
// 0.5s duration for T1, scales with tier
// Color matches bullet color

import { forwardRef, useImperativeHandle, useRef, useCallback, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import System, { SpriteRenderer, Emitter, Rate, Span, Position, Mass, Life, BodySprite, Radius, RadialVelocity, Alpha, Color, Scale, Force, RandomDrift } from 'three-nebula';
import * as THREE from 'three';

// Maximum concurrent impact effects
const MAX_IMPACTS = 20;

// Base values for T1
const BASE_SIZE = 0.25; // 0.25m diameter for T1
const BASE_DURATION = 0.5; // 0.5 seconds for T1

// Particle texture - transparent soft circle
const PARTICLE_TEXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABhElEQVRYhe2XMU7DQBBF3yxJgUQBHIAChyAFR+AIdJQcgTJH4AiUFBQcgQo4AFQUSHSAEE9hs9mNvWs7WSt8aSXH8s78P7OzHsMSIYRO+3mC0EEfUEZZ4AR4AO6AZeBU0p2kK0lXkm4k9SXdSrqU1JXUkXQhqS3pVNJJ+v6ppPbY+fOkAXQD9QQ+gDfgFbgGPiW9J5f3AG8I4QhYAjaAFWAT2ALWgXVgDegBC8ACMAcMgAHwDvSBt+SDEQEuJaX/bwBngCPgEPgBnoDH+G0DeDYzAYaBzd8HzA+QdA7MAJ9AV1IP+AAeg1APYAD0g9ADsA9sA9vx6raBDeC7xGS2FPgBnkfEFfAN3AMPIb6dgILXDCH0U+vQJFZ5BXwAzwN8l4TQ97j2gGP+/zJLMCk+TwJrgIVhO/H5JbACZJZlrBBCr4lwlkUYSf8bDWAROGRYc1Q4LwCWGW4zXWCO4d7xJnAS4usB+yGE/hjfJL+LawC1B2B5FPgVxw+B5VL/Pxd/AVKPNJWYuG0QAAAAAElFTkSuQmCC';

export interface ImpactConfig {
  color?: string;
  size?: number;
  tier?: number;
}

export interface BulletImpactsHandle {
  spawnImpact: (position: THREE.Vector3, config?: ImpactConfig) => void;
}

interface ActiveImpact {
  emitter: Emitter;
  startTime: number;
  duration: number;
}

// Darken a hex color for the fire fade
function darkenColor(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  
  const newR = Math.min(255, Math.floor(r * 0.9));
  const newG = Math.floor(g * 0.3);
  const newB = Math.floor(b * 0.1);
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

export const BulletImpacts = forwardRef<BulletImpactsHandle, {}>((_, ref) => {
  const { scene } = useThree();
  const systemRef = useRef<System | null>(null);
  const activeImpactsRef = useRef<ActiveImpact[]>([]);
  const textureRef = useRef<THREE.Sprite | null>(null);

  // Initialize system once
  useEffect(() => {
    const system = new System();
    const renderer = new SpriteRenderer(scene, THREE);
    system.addRenderer(renderer);
    systemRef.current = system;

    // Pre-load texture as a sprite for BodySprite
    const loader = new THREE.TextureLoader();
    loader.load(PARTICLE_TEXTURE, (texture) => {
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
      textureRef.current = new THREE.Sprite(material);
    });

    return () => {
      system.destroy();
      systemRef.current = null;
    };
  }, [scene]);

  // Create emitter synchronously
  const createEmitter = useCallback((
    position: THREE.Vector3,
    size: number,
    duration: number,
    color: string
  ): Emitter => {
    const radiusMin = size * 0.15;
    const radiusMax = size * 0.4;
    const lifeMin = duration * 0.4;
    const lifeMax = duration * 0.9;
    const endColor = darkenColor(color);

    const emitter = new Emitter();
    
    emitter
      .setRate(new Rate(new Span(18, 25), new Span(0.001, 0.001)))
      .setPosition(new Position(position))
      .addInitializers([
        new Mass(0.5, 1),
        new Life(lifeMin, lifeMax),
        new BodySprite(THREE, PARTICLE_TEXTURE),
        new Radius(radiusMin, radiusMax),
        new RadialVelocity(2.5, new THREE.Vector3(0, 1, 0), 55),
      ])
      .addBehaviours([
        new Alpha(1, 0),
        new Color(color, endColor),
        new Scale(1.2, 0.05),
        new Force(0, 1.8, 0),
        new RandomDrift(0.5, 0.25, 0.5),
      ])
      .emit(1); // Emit once (burst)

    return emitter;
  }, []);

  const spawnImpact = useCallback((position: THREE.Vector3, config?: ImpactConfig) => {
    if (!systemRef.current) return;

    const tier = config?.tier ?? 1;
    const color = config?.color ?? '#FFFF00';
    
    const tierMultiplier = 1 + (tier - 1) * 0.1;
    const size = config?.size ?? (BASE_SIZE * tierMultiplier);
    const duration = BASE_DURATION * tierMultiplier;

    // Remove oldest impact if at limit
    if (activeImpactsRef.current.length >= MAX_IMPACTS) {
      const oldest = activeImpactsRef.current.shift();
      if (oldest) {
        oldest.emitter.stopEmit();
        oldest.emitter.particles.length = 0;
        systemRef.current.removeEmitter(oldest.emitter);
      }
    }

    const emitter = createEmitter(position, size, duration, color);
    systemRef.current.addEmitter(emitter);

    activeImpactsRef.current.push({
      emitter,
      startTime: performance.now(),
      duration: duration * 1000,
    });
  }, [createEmitter]);

  useImperativeHandle(ref, () => ({ spawnImpact }), [spawnImpact]);

  // Update system and clean up expired emitters
  useFrame((_, delta) => {
    if (!systemRef.current) return;
    
    systemRef.current.update(delta);

    const now = performance.now();
    const toRemove: number[] = [];

    for (let i = 0; i < activeImpactsRef.current.length; i++) {
      const impact = activeImpactsRef.current[i];
      const elapsed = now - impact.startTime;

      if (elapsed > impact.duration) {
        impact.emitter.stopEmit();
        impact.emitter.particles.length = 0;
        systemRef.current.removeEmitter(impact.emitter);
        toRemove.push(i);
      }
    }

    // Remove expired (reverse order)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      activeImpactsRef.current.splice(toRemove[i], 1);
    }
  });

  return null;
});

BulletImpacts.displayName = 'BulletImpacts';
