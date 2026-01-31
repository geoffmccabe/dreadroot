// FlameDemoSpawner: R3F bridge component for spawning demo effects from the admin panel
// Mounted inside FortressScene (inside Canvas), exposes handle via context ref

import { forwardRef, useImperativeHandle, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { BulletImpactsHandle } from './FortressImpacts';
import type { UniversalFlameRendererHandle } from './UniversalFlameRenderer';
import type { FlameColorMode } from './flameEffectPresets';

export interface DemoConfig {
  system: 'tpf' | 'ufr';
  type: string; // FlameType or TpfType
  colors: string[];
  size: number;
  height: number;
  duration: number;
  particleCount: number;
  colorMode?: FlameColorMode;
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
    const { camera } = useThree();

    const getDemoPosition = useCallback((): THREE.Vector3 => {
      // Spawn 5 units in front of camera at camera height
      const dir = new THREE.Vector3(0, 0, -1);
      dir.applyQuaternion(camera.quaternion);
      dir.y = 0; // Keep horizontal
      dir.normalize();

      const pos = camera.position.clone();
      pos.add(dir.multiplyScalar(5));
      return pos;
    }, [camera]);

    const spawnDemo = useCallback((config: DemoConfig) => {
      const position = getDemoPosition();

      if (config.system === 'tpf') {
        const impacts = bulletImpactsRef.current;
        if (!impacts) return;

        if (config.type === 'single') {
          // Single fire: spawn as impact with size=0 so no hex offset
          impacts.spawnImpact(position, {
            colors: config.colors,
            size: 0.01, // Minimal hex spread for single fire
            height: config.height,
            duration: config.duration,
          });
        } else {
          // hex-impact
          impacts.spawnImpact(position, {
            colors: config.colors,
            size: config.size,
            height: config.height,
            duration: config.duration,
          });
        }
      } else {
        // UFR system
        const ufr = universalFlameRef.current;
        if (!ufr) return;

        ufr.spawnFlame({
          type: config.type as 'point' | 'hex' | 'plume',
          position,
          colors: config.colors,
          size: config.size,
          height: config.height,
          duration: config.duration,
          particleCount: config.particleCount,
          colorMode: config.colorMode,
        });
      }
    }, [getDemoPosition, bulletImpactsRef, universalFlameRef]);

    const clearDemo = useCallback(() => {
      // Effects are time-limited and auto-expire; no-op for now
    }, []);

    useImperativeHandle(ref, () => ({ spawnDemo, clearDemo }), [spawnDemo, clearDemo]);

    return null;
  }
);

FlameDemoSpawner.displayName = 'FlameDemoSpawner';
