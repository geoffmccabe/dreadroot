// Global post-processing "look" pass: selective Bloom + AgX tone mapping.
//
// TIERED (Phase 1 = two tiers):
//  * LOW (mobile / coarse-pointer / small screens): renders NOTHING here. The base
//    renderer keeps AgX tone mapping (set in Fortress onCreated), so phones get the
//    improved tone curve with zero extra full-screen passes. This is also the safe
//    path away from the float-target bloom bugs that bite hardest on mobile GPUs.
//  * HIGH (desktop): full composer — kernel Bloom (flash-proof, NOT mipmapBlur) then
//    AgX tone mapping LAST so the final image is clamped. While this is mounted the
//    base renderer is switched to NoToneMapping (the composer owns tone mapping now),
//    and restored to AgX on unmount.
//
// Flash safety: the old pipeline used mipmapBlur, which smears a single shader NaN
// across the entire screen → full-screen black flashing while moving. A fixed kernel
// keeps a bad pixel local, and the final ToneMapping clamps the HDR buffer.
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode, KernelSize } from 'postprocessing';
import { NoToneMapping } from 'three';
import { LOOK } from './lookConfig';

function useIsLowTier() {
  return useMemo(
    () =>
      typeof window !== 'undefined' &&
      ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        Math.min(window.innerWidth, window.innerHeight) < 800),
    []
  );
}

export function LookComposer() {
  const isLowTier = useIsLowTier();
  const gl = useThree((s) => s.gl);

  // While the composer owns tone mapping, the base renderer must NOT also tone-map
  // (double mapping). Restore AgX on unmount so the no-composer path stays correct.
  useEffect(() => {
    if (isLowTier) return;
    const prev = gl.toneMapping;
    gl.toneMapping = NoToneMapping;
    return () => {
      gl.toneMapping = prev;
    };
  }, [gl, isLowTier]);

  if (isLowTier) return null;

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        kernelSize={KernelSize.MEDIUM}
        intensity={LOOK.bloom.intensity}
        luminanceThreshold={LOOK.bloom.luminanceThreshold}
        luminanceSmoothing={LOOK.bloom.luminanceSmoothing}
        radius={LOOK.bloom.radius}
      />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
}
