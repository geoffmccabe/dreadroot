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
import { registerRecipe } from './recipes';
import { loadEffectRecipesFromDB } from './effectsDb';
import { GAME_ID } from '@/config/game';
import type { EffectsHandle, QualityTier, EffectEmitter } from './types';

const PREVIEW_CODE = '__preview';

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

  // Live admin preview state (a cloud floating in front of the camera).
  const preview = useRef({ active: false, emitter: null as EffectEmitter | null });
  const previewPos = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.add(backend.object3D);
    return () => {
      g.remove(backend.object3D);
      backend.dispose();
    };
  }, [backend]);

  // Load DB-authored recipes into the registry (degrades gracefully if the
  // effect_definitions table isn't present yet — fallback recipes keep running).
  useEffect(() => {
    let alive = true;
    loadEffectRecipesFromDB().then((recipes) => {
      if (!alive) return;
      for (const r of recipes) backend.updateRecipe(r);
    });
    return () => { alive = false; };
  }, [backend]);

  useImperativeHandle(
    ref,
    (): EffectsHandle => ({
      emitPuff: (code, pos) => backend.emitPuff(code, pos),
      emitBurst: (code, pos, n) => backend.emitBurst(code, pos, n),
      createEmitter: (code, getPos, importance) => backend.createEmitter(code, getPos, importance),
      setQuality: (q: QualityTier) => backend.setQuality(cfg.qualityScale[q]),
      updateRecipe: (recipe) => backend.updateRecipe(recipe),
      setPreview: (recipe) => {
        if (!recipe) {
          preview.current.active = false;
          return;
        }
        const pr = { ...recipe, code: PREVIEW_CODE };
        registerRecipe(pr);
        backend.updateRecipe(pr); // live-update the pool if it already exists
        preview.current.active = true;
        if (!preview.current.emitter) {
          preview.current.emitter = backend.createEmitter(
            PREVIEW_CODE,
            (out) => {
              if (!preview.current.active) return false;
              out.copy(previewPos);
              return true;
            },
            1.0,
          );
        }
      },
    }),
    [backend, cfg, previewPos],
  );

  useFrame((state, dt) => {
    const cam = state.camera;
    if (preview.current.active) {
      cam.getWorldDirection(dir);
      previewPos.copy(cam.position).addScaledVector(dir, 4);
      previewPos.y -= 0.4; // a touch below eye-line so it reads as a cloud ahead
    }
    backend.tick(Math.min(dt, 0.05), cam.position.x, cam.position.z);
  });

  return <group ref={groupRef} />;
});

EffectsRoot.displayName = 'EffectsRoot';
