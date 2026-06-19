// Global post-processing layer. Currently: Bloom — bright/emissive pixels bleed onto
// their neighbours, which is what makes the builder's emissive lights actually look
// like they illuminate surrounding blocks (and generally prettier glow everywhere).
//
// Perf: a full-screen blur pass each frame. Tuned down on mobile (no MSAA, lower
// intensity). luminanceThreshold is high so ordinary stone/ground does NOT bloom —
// only genuinely bright things (emissive lights, sun glints) do. Flip ENABLE_POSTFX
// off to remove the whole pipeline instantly if it ever needs to go.
import { useMemo } from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

const ENABLE_POSTFX = true;

export function FortressPostFX() {
  const isMobile = useMemo(
    () =>
      typeof window !== 'undefined' &&
      ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        Math.min(window.innerWidth, window.innerHeight) < 800),
    []
  );

  if (!ENABLE_POSTFX) return null;

  return (
    <EffectComposer multisampling={isMobile ? 0 : 4}>
      <Bloom
        mipmapBlur
        intensity={isMobile ? 0.5 : 0.85}
        luminanceThreshold={0.7}
        luminanceSmoothing={0.2}
        radius={0.6}
      />
    </EffectComposer>
  );
}
