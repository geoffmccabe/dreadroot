// EffectsRoot — the single mount point for the universal effects module. Mounts
// the active backend(s) and exposes the EffectsHandle via ref (mirrors how
// UniversalFlameRenderer / BulletImpacts expose handles). World-agnostic: it
// uses continuous world-space coords, so it works in BOTH the voxel world and
// the Siege Worlds terrain world unchanged.
//
// Phase 1: one backend (instanced billboards). Future backends (six-way-lit
// flipbooks, WebGPU compute) slot in here behind the same FXBackend interface.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BillboardBackend } from './BillboardBackend';
import { getEffectsConfig } from './effectsEngineConfig';
import { GAME_ID } from '@/config/game';
import type { EffectsHandle, QualityTier } from './types';

export const EffectsRoot = forwardRef<EffectsHandle>((_, ref) => {
  const groupRef = useRef<THREE.Group>(null);

  const { backend, cfg } = useMemo(() => {
    const cfg = getEffectsConfig(GAME_ID);
    const backend = new BillboardBackend({
      capPerRecipe: cfg.maxInstancesPerRecipe,
      maxEmitters: cfg.maxEmitters,
      quality: cfg.qualityScale[cfg.defaultQuality],
    });
    return { backend, cfg };
  }, []);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.add(backend.object3D);
    return () => {
      g.remove(backend.object3D);
      backend.dispose();
    };
  }, [backend]);

  useImperativeHandle(
    ref,
    (): EffectsHandle => ({
      emitPuff: (code, pos) => backend.emitPuff(code, pos),
      emitBurst: (code, pos, n) => backend.emitBurst(code, pos, n),
      createEmitter: (code, getPos, importance) => backend.createEmitter(code, getPos, importance),
      setQuality: (q: QualityTier) => backend.setQuality(cfg.qualityScale[q]),
    }),
    [backend, cfg],
  );

  useFrame((state, dt) => {
    const cam = state.camera;
    backend.tick(Math.min(dt, 0.05), cam.position.x, cam.position.z);
  });

  return <group ref={groupRef} />;
});

EffectsRoot.displayName = 'EffectsRoot';
