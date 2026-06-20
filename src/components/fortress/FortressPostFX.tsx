// Global post-processing layer. Currently: Bloom — bright/emissive pixels bleed onto
// their neighbours, which is what makes the builder's emissive lights actually look
// like they illuminate surrounding blocks (and generally prettier glow everywhere).
//
// Perf: a full-screen blur pass each frame. Tuned down on mobile (no MSAA, lower
// intensity). luminanceThreshold is high so ordinary stone/ground does NOT bloom —
// only genuinely bright things (emissive lights, sun glints) do. Flip ENABLE_POSTFX
// off to remove the whole pipeline instantly if it ever needs to go.
import { useMemo } from 'react';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

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
        intensity={isMobile ? 0.6 : 0.9}
        // High threshold so ordinary stone/ground/sky does NOT bloom — only genuinely
        // bright emissives (glow materials rendered unclamped > 1) and the sun exceed it.
        luminanceThreshold={0.92}
        // A SOFT threshold ramp (was 0.025) so pixels crossing the edge fade in/out of
        // bloom instead of popping on/off every frame — that popping is the flicker.
        luminanceSmoothing={0.3}
        radius={0.8}
      />
      {/* Tone-map LAST so the final image is clamped (ACES). Without it the composer
          output is raw HDR — any unclamped/NaN pixel (e.g. a shader edge case) can blow
          out or, through mipmapBlur, flash the whole screen black. */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
