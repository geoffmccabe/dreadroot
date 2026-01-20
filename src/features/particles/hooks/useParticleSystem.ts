// Hook for managing particle effects using three-nebula
import { useRef, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import System, { SpriteRenderer } from 'three-nebula';
import * as THREE from 'three';
import { ParticleEffectType, ActiveParticleEffect } from '../types';
import { PARTICLE_PRESETS } from '../presets';

interface ParticleSystemState {
  system: System | null;
  activeEffects: Map<string, ActiveParticleEffect>;
}

export function useParticleSystem() {
  const { scene } = useThree();
  const stateRef = useRef<ParticleSystemState>({
    system: null,
    activeEffects: new Map(),
  });
  const systemInitializedRef = useRef(false);

  // Initialize the particle system
  const initSystem = useCallback(async () => {
    if (systemInitializedRef.current) return;
    
    try {
      const system = new System();
      const renderer = new SpriteRenderer(scene, THREE);
      system.addRenderer(renderer);
      stateRef.current.system = system;
      systemInitializedRef.current = true;
      console.log('[Particles] System initialized');
    } catch (error) {
      console.error('[Particles] Failed to initialize:', error);
    }
  }, [scene]);

  // Spawn a particle effect at a position
  const spawnEffect = useCallback(async (
    type: ParticleEffectType,
    position: [number, number, number],
    options?: { scale?: number; duration?: number; onComplete?: () => void }
  ): Promise<string | null> => {
    if (!stateRef.current.system) {
      await initSystem();
    }
    
    const system = stateRef.current.system;
    if (!system) {
      console.warn('[Particles] System not available');
      return null;
    }

    const preset = PARTICLE_PRESETS[type];
    if (!preset) {
      console.warn(`[Particles] Unknown effect type: ${type}`);
      return null;
    }

    const effectId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const scale = options?.scale ?? 1;

    try {
      // Load the preset into the system with position offset
      const modifiedPreset = {
        ...preset,
        emitters: preset.emitters.map(emitter => ({
          ...emitter,
          position: {
            x: position[0],
            y: position[1],
            z: position[2],
          },
          initializers: emitter.initializers.map((init: any) => {
            if (init.type === 'Radius') {
              return {
                ...init,
                properties: {
                  ...init.properties,
                  min: init.properties.min * scale,
                  max: init.properties.max * scale,
                },
              };
            }
            return init;
          }),
        })),
      };

      await System.fromJSONAsync(modifiedPreset, THREE).then((loadedSystem: System) => {
        // Copy emitters to our main system
        loadedSystem.emitters.forEach((emitter: any) => {
          system.addEmitter(emitter);
        });
      });

      // Track the effect
      stateRef.current.activeEffects.set(effectId, {
        id: effectId,
        config: {
          type,
          position,
          scale,
          duration: options?.duration,
          onComplete: options?.onComplete,
        },
        startTime: performance.now(),
      });

      // REMOVED: console.log spam - particles spawn frequently, logging kills FPS
      return effectId;
    } catch (error) {
      console.error(`[Particles] Failed to spawn ${type}:`, error);
      return null;
    }
  }, [initSystem]);

  // Spawn a one-shot effect (like explosion)
  const spawnOneShot = useCallback((
    type: ParticleEffectType,
    position: [number, number, number],
    scale?: number
  ) => {
    return spawnEffect(type, position, { 
      scale, 
      duration: type === 'explosion' ? 1500 : 3000 
    });
  }, [spawnEffect]);

  // Update the particle system each frame
  useFrame((_, delta) => {
    const { system, activeEffects } = stateRef.current;
    if (!system) return;

    system.update(delta);

    // Clean up expired effects
    const now = performance.now();
    for (const [id, effect] of activeEffects.entries()) {
      if (effect.config.duration) {
        const elapsed = now - effect.startTime;
        if (elapsed > effect.config.duration) {
          activeEffects.delete(id);
          effect.config.onComplete?.();
        }
      }
    }
  });

  // Clean up all effects
  const clearAllEffects = useCallback(() => {
    const { system, activeEffects } = stateRef.current;
    if (system) {
      system.emitters.forEach((emitter: any) => {
        emitter.destroy();
      });
    }
    activeEffects.clear();
    console.log('[Particles] Cleared all effects');
  }, []);

  return {
    spawnEffect,
    spawnOneShot,
    clearAllEffects,
    isInitialized: systemInitializedRef.current,
  };
}
