// FlameDemoSpawner: R3F bridge component for spawning demo effects from the admin panel
// Mounted inside FortressScene (inside Canvas), exposes handle via context ref
// Supports TPF (volumetric), UFR (sprite flames), and Nebula (GPU particles)

import { forwardRef, useImperativeHandle, useCallback, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import System, { SpriteRenderer } from 'three-nebula';
import type { BulletImpactsHandle } from './FortressImpacts';
import type { UniversalFlameRendererHandle } from './UniversalFlameRenderer';
import type { FlameColorMode } from './flameEffectPresets';
import type { NebulaPreset } from '@/features/particles/presets';

export interface DemoConfig {
  system: 'tpf' | 'ufr' | 'nebula';
  type: string; // FlameType or TpfType or NebulaEffectId
  colors: string[];
  size: number;
  height: number;
  duration: number;
  particleCount: number;
  colorMode?: FlameColorMode;
  nebulaPreset?: NebulaPreset;
}

export interface FlameDemoHandle {
  spawnDemo: (config: DemoConfig) => void;
  clearDemo: () => void;
}

interface FlameDemoSpawnerProps {
  bulletImpactsRef: React.MutableRefObject<BulletImpactsHandle | null>;
  universalFlameRef: React.MutableRefObject<UniversalFlameRendererHandle | null>;
}

export const FlameDemoSpawner = forwardRef<FlameDemoHandle, FlameDemoSpawnerProps>(
  ({ bulletImpactsRef, universalFlameRef }, ref) => {
    const { camera, scene } = useThree();
    const nebulaSystemRef = useRef<System | null>(null);
    const nebulaGenRef = useRef(0); // Generation counter to prevent stale async
    const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const activeConfigRef = useRef<DemoConfig | null>(null);

    const getDemoPosition = useCallback((): THREE.Vector3 => {
      // Place effect at 22% from the left edge of the screen, at camera eye level.
      // Unproject to convert screen-space X into a world-space direction.
      const ndcX = 0.22 * 2 - 1; // 22% from left → -0.56 NDC
      const target = new THREE.Vector3(ndcX, 0, 0.5);
      target.unproject(camera);
      const dir = target.sub(camera.position).normalize();
      // Flatten to horizontal so the depth stays consistent
      dir.y = 0;
      dir.normalize();
      const pos = camera.position.clone().add(dir.multiplyScalar(8));
      // Keep Y near camera eye level so depthTest systems (UFR, Nebula) are visible
      pos.y = camera.position.y - 1;
      return pos;
    }, [camera]);

    const destroyNebulaSystem = useCallback(() => {
      nebulaGenRef.current++; // Invalidate any pending async creation
      if (nebulaSystemRef.current) {
        nebulaSystemRef.current.destroy();
        nebulaSystemRef.current = null;
      }
    }, []);

    const stopRepeat = useCallback(() => {
      if (repeatIntervalRef.current) {
        clearInterval(repeatIntervalRef.current);
        repeatIntervalRef.current = null;
      }
      activeConfigRef.current = null;
    }, []);

    // Spawn a single instance of a TPF/UFR effect (used by repeat loop)
    const spawnOnce = useCallback((config: DemoConfig, position: THREE.Vector3) => {
      if (config.system === 'tpf') {
        const impacts = bulletImpactsRef.current;
        if (!impacts) return;
        if (config.type === 'single') {
          impacts.spawnImpact(position, {
            colors: config.colors,
            size: 0.01,
            height: config.height,
            duration: config.duration,
          });
        } else {
          impacts.spawnImpact(position, {
            colors: config.colors,
            size: config.size,
            height: config.height,
            duration: config.duration,
          });
        }
      } else if (config.system === 'ufr') {
        const ufr = universalFlameRef.current;
        if (!ufr) return;
        // Plume renders downward — raise spawn position so it doesn't clip into terrain
        const spawnPos = position.clone();
        if (config.type === 'plume') {
          spawnPos.y += config.height * 3;
        }
        ufr.spawnFlame({
          type: config.type as 'point' | 'hex' | 'plume',
          position: spawnPos,
          colors: config.colors,
          size: config.size,
          height: config.height,
          duration: config.duration,
          particleCount: config.particleCount,
          colorMode: config.colorMode,
        });
      }
    }, [bulletImpactsRef, universalFlameRef]);

    const spawnDemo = useCallback((config: DemoConfig) => {
      const position = getDemoPosition();

      // Stop any existing repeat loop
      stopRepeat();
      destroyNebulaSystem();

      if (config.system === 'nebula') {
        if (!config.nebulaPreset) return;

        // Build modified preset using the same pattern as ParticleEffect.tsx
        // (spread-clone emitters with position override — avoids JSON.stringify issues)
        const sourcePreset = config.nebulaPreset;
        const modifiedPreset = {
          ...sourcePreset,
          emitters: sourcePreset.emitters.map((emitter: any) => ({
            ...emitter,
            position: { x: position.x, y: position.y, z: position.z },
          })),
        };

        console.log('[FlameDemoSpawner] Creating nebula at', position.x.toFixed(1), position.y.toFixed(1), position.z.toFixed(1));

        // Create system — nebula emitters are continuous, no need to repeat
        const gen = nebulaGenRef.current;
        const initNebula = async () => {
          try {
            const system = await System.fromJSONAsync(modifiedPreset, THREE);
            // Discard stale creation if params changed while async was pending
            if (gen !== nebulaGenRef.current) {
              system.destroy();
              return;
            }
            const renderer = new SpriteRenderer(scene, THREE);
            system.addRenderer(renderer);
            nebulaSystemRef.current = system;
            console.log('[FlameDemoSpawner] Nebula created, emitters:', system.emitters.length);
          } catch (err) {
            console.error('[FlameDemoSpawner] Nebula init failed:', err);
          }
        };
        initNebula();
      } else {
        // TPF/UFR: spawn immediately, then repeat on an interval matching their duration
        activeConfigRef.current = config;
        spawnOnce(config, position);

        const repeatMs = Math.max(config.duration * 1000, 500);
        repeatIntervalRef.current = setInterval(() => {
          // Recalculate position each time in case camera moves
          const pos = getDemoPosition();
          if (activeConfigRef.current) {
            spawnOnce(activeConfigRef.current, pos);
          }
        }, repeatMs);
      }
    }, [getDemoPosition, spawnOnce, scene, destroyNebulaSystem, stopRepeat]);

    const clearDemo = useCallback(() => {
      stopRepeat();
      destroyNebulaSystem();
    }, [stopRepeat, destroyNebulaSystem]);

    // Update nebula system each frame + patch particle materials for proper depth
    useFrame((_, delta) => {
      if (nebulaSystemRef.current) {
        nebulaSystemRef.current.update(delta);
        // Patch sprite materials so nebula renders in front of terrain/objects.
        // Keep NormalBlending (AdditiveBlending makes particles invisible on bright skies).
        for (const emitter of nebulaSystemRef.current.emitters) {
          for (const particle of (emitter as any).particles) {
            const mat = particle.body?.material;
            if (mat && !mat._demoPatched) {
              mat.transparent = true;
              mat.depthWrite = false;
              mat.depthTest = false;
              mat._demoPatched = true;
            }
          }
        }
      }
    });

    useImperativeHandle(ref, () => ({ spawnDemo, clearDemo }), [spawnDemo, clearDemo]);

    return null;
  }
);

FlameDemoSpawner.displayName = 'FlameDemoSpawner';
