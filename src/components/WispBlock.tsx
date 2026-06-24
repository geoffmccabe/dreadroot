import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { BlockType } from '@/types/blocks';
import { frameLoop } from '@/lib/frameLoop';
import { wispStyleFor, WISP_FIRE_COLORS, type WispEffect } from '@/lib/wispTierStyles';

interface WispBlockProps {
  positionRef: React.MutableRefObject<THREE.Vector3>;
  blockType: BlockType;
  onMeshReady?: (mesh: THREE.Mesh | null) => void;
}

export const WispBlock: React.FC<WispBlockProps> = ({
  positionRef,
  blockType,
  onMeshReady,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowIntensityRef = useRef(0.5);
  const glowDirectionRef = useRef(1);

  // Per-tier look (color, glow, metal, opacity + which effect to animate).
  const { style, effect } = useMemo(() => wispStyleFor(blockType.tier), [blockType.tier]);

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(style.color),
      transparent: style.opacity < 1,
      opacity: style.opacity,
      emissive: new THREE.Color(style.emissive),
      emissiveIntensity: style.emissiveIntensity,
      metalness: style.metalness,
      roughness: style.roughness,
      side: THREE.DoubleSide,
    });
  }, [style]);

  // Scratch colors reused per-frame (no per-frame allocation).
  const baseEmissive = useMemo(() => new THREE.Color(style.emissive), [style.emissive]);
  const scratch = useMemo(() => new THREE.Color(), []);
  const fireColors = useMemo(() => WISP_FIRE_COLORS.map((c) => new THREE.Color(c)), []);

  useEffect(() => {
    if (meshRef.current && onMeshReady) onMeshReady(meshRef.current);
    return () => { if (onMeshReady) onMeshReady(null); };
  }, [onMeshReady]);

  useEffect(() => {
    const unregister = frameLoop.register('wisp-block', (delta, elapsed) => {
      const mesh = meshRef.current;
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;

      // Movement: lerp toward target, bob, rotate (unchanged feel).
      const targetPos = positionRef.current;
      mesh.position.lerp(targetPos, 0.3);
      mesh.position.y = targetPos.y + Math.sin(elapsed * 2) * 0.1;
      mesh.rotation.y += delta * 0.5;

      applyWispEffect(effect, mat, style.emissiveIntensity, elapsed, delta, {
        baseEmissive, scratch, fireColors,
        glowIntensityRef, glowDirectionRef,
      });
    }, 60);
    return unregister;
  }, [positionRef, effect, style.emissiveIntensity, baseEmissive, scratch, fireColors]);

  return (
    <mesh
      ref={meshRef}
      position={[positionRef.current.x, positionRef.current.y, positionRef.current.z]}
      material={material}
    >
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
};

interface EffectCtx {
  baseEmissive: THREE.Color;
  scratch: THREE.Color;
  fireColors: THREE.Color[];
  glowIntensityRef: React.MutableRefObject<number>;
  glowDirectionRef: React.MutableRefObject<number>;
}

// One mesh → per-frame mutation is cheap. Each effect tweaks emissive
// colour/intensity (and colour for rainbow) on top of the base material.
function applyWispEffect(
  effect: WispEffect,
  mat: THREE.MeshStandardMaterial,
  baseIntensity: number,
  elapsed: number,
  delta: number,
  ctx: EffectCtx,
): void {
  switch (effect) {
    case 'matte':
      // dull, no glow — leave material as-is.
      return;

    case 'glass': {
      // gentle symmetric pulse around the baseline glow.
      const g = ctx.glowIntensityRef;
      const d = ctx.glowDirectionRef;
      g.current += d.current * delta * 1.5;
      if (g.current >= baseIntensity + 0.2) { g.current = baseIntensity + 0.2; d.current = -1; }
      else if (g.current <= Math.max(0, baseIntensity - 0.2)) { g.current = Math.max(0, baseIntensity - 0.2); d.current = 1; }
      mat.emissiveIntensity = g.current;
      return;
    }

    case 'radiant': {
      // strong, slow, heavenly breathing.
      mat.emissiveIntensity = baseIntensity + Math.sin(elapsed * 1.2) * 0.25;
      return;
    }

    case 'metallic': {
      // subtle shimmer; metalness already set on the material.
      mat.emissiveIntensity = baseIntensity + Math.sin(elapsed * 3.0) * 0.15;
      return;
    }

    case 'electric': {
      // mostly low, with occasional bright white-tinted crackle spikes.
      const spike = Math.random() < 0.12;
      if (spike) {
        ctx.scratch.copy(ctx.baseEmissive).lerp(WHITE, 0.7);
        mat.emissive.copy(ctx.scratch);
        mat.emissiveIntensity = baseIntensity + 0.8;
      } else {
        mat.emissive.copy(ctx.baseEmissive);
        mat.emissiveIntensity = baseIntensity * (0.6 + Math.random() * 0.25);
      }
      return;
    }

    case 'flames': {
      // cycle through fire colours + flicker the intensity.
      const n = ctx.fireColors.length;
      const f = (elapsed * 6) % n;
      const i0 = Math.floor(f);
      const i1 = (i0 + 1) % n;
      ctx.scratch.copy(ctx.fireColors[i0]).lerp(ctx.fireColors[i1], f - i0);
      mat.emissive.copy(ctx.scratch);
      mat.emissiveIntensity = baseIntensity + Math.sin(elapsed * 18) * 0.2 + Math.random() * 0.15;
      return;
    }

    case 'rainbow': {
      // hue sweeps the spectrum on both diffuse and emissive.
      const h = (elapsed * 0.15) % 1;
      mat.color.setHSL(h, 0.9, 0.55);
      mat.emissive.setHSL(h, 0.9, 0.5);
      mat.emissiveIntensity = baseIntensity;
      return;
    }
  }
}

const WHITE = new THREE.Color('#ffffff');

export default WispBlock;
