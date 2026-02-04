// Standalone particle effect component
// Use this to spawn effects declaratively in JSX

import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import System, { SpriteRenderer } from 'three-nebula';
import * as THREE from 'three';
import { ParticleEffectType } from '../types';
import { PARTICLE_PRESETS, NebulaPreset } from '../presets';

interface ParticleEffectProps {
  type: ParticleEffectType;
  position: [number, number, number];
  scale?: number;
  active?: boolean;
  onComplete?: () => void;
  customPreset?: NebulaPreset;
}

export function ParticleEffect({
  type,
  position,
  scale = 1,
  active = true,
  onComplete,
  customPreset,
}: ParticleEffectProps) {
  const { scene } = useThree();
  const systemRef = useRef<System | null>(null);
  const hasCalledComplete = useRef(false);

  // Initialize effect
  useEffect(() => {
    if (!active) return;

    const preset = customPreset ?? PARTICLE_PRESETS[type];
    if (!preset) {
      console.warn(`[ParticleEffect] Unknown type: ${type}`);
      return;
    }

    const initEffect = async () => {
      const modifiedPreset = {
        ...preset,
        emitters: preset.emitters.map(emitter => ({
          ...emitter,
          position: { x: position[0], y: position[1], z: position[2] },
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

      try {
        const system = await System.fromJSONAsync(modifiedPreset, THREE);
        const renderer = new SpriteRenderer(scene, THREE);
        system.addRenderer(renderer);
        systemRef.current = system;
      } catch (error) {
        console.error('[ParticleEffect] Failed to initialize:', error);
      }
    };

    initEffect();

    return () => {
      if (systemRef.current) {
        systemRef.current.destroy();
        systemRef.current = null;
      }
    };
  }, [type, position[0], position[1], position[2], scale, active, scene]);

  // Update each frame
  useFrame((_, delta) => {
    if (systemRef.current && active) {
      systemRef.current.update(delta);

      // Check if all particles are dead for one-shot effects
      const allDead = systemRef.current.emitters.every((emitter: any) => 
        emitter.particles.length === 0 && emitter.totalEmitTimes === 0
      );

      if (allDead && !hasCalledComplete.current) {
        hasCalledComplete.current = true;
        onComplete?.();
      }
    }
  });

  return null;
}
