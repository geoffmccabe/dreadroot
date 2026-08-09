// Desktop bloom pass (mobile skips it entirely — see tier check). Tone mapping now lives
// on the renderer (LookSync), so this composer does Bloom ONLY.
//
// TIERED:
//  * LOW (mobile / coarse-pointer / small screens): renders NOTHING. The renderer's AgX
//    tone mapping still applies — phones get the improved curve with no extra passes.
//  * HIGH (desktop): kernel Bloom so emissives/sun glints bleed light.
//
// Flash safety: kernel blur, NOT mipmapBlur. mipmapBlur smeared a single shader NaN
// across the whole screen (the old black-flash-while-moving bug); a fixed kernel keeps a
// bad pixel local. All params are live from lookStore (Lightning Panel → Render section).
import { useMemo } from 'react';
import { EffectComposer, Bloom, BrightnessContrast, HueSaturation, Vignette } from '@react-three/postprocessing';
import { KernelSize } from 'postprocessing';
import { LOOK } from './lookConfig';
import { useLook } from './lookStore';
import { useGlobeLook } from './globeLookStore';

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
  const { bloomEnabled, bloomIntensity, bloomThreshold, bloomRadius } = useLook();

  // The Mini Earth's grade, from the Lightning Panel. Off by default and off on every other map:
  // this curve is tuned for one strong sun over open landscape and would be a regression inside a
  // torch-lit fortress.
  const g = useGlobeLook();
  const grade = g.enabled && g.gradeOn;

  if (isLowTier || (!bloomEnabled && !grade)) return null;

  return (
    <EffectComposer multisampling={0}>
      {bloomEnabled ? (
        <Bloom
          kernelSize={KernelSize.MEDIUM}
          intensity={bloomIntensity}
          luminanceThreshold={bloomThreshold}
          luminanceSmoothing={LOOK.bloom.luminanceSmoothing}
          radius={bloomRadius}
        />
      ) : <></>}
      {/* Contrast and saturation BEFORE the vignette, so the vignette darkens a graded image rather
          than being stretched by a curve applied after it. */}
      {grade ? <BrightnessContrast brightness={0} contrast={g.contrast} /> : <></>}
      {grade ? <HueSaturation hue={0} saturation={g.saturation} /> : <></>}
      {grade && g.vignette > 0 ? <Vignette offset={0.28} darkness={g.vignette} eskil={false} /> : <></>}
    </EffectComposer>
  );
}
