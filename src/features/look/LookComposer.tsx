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
import { EffectComposer, Bloom, BrightnessContrast, HueSaturation, Vignette, SSAO } from '@react-three/postprocessing';
import { KernelSize, BlendFunction } from 'postprocessing';
import { isCinematicGrade } from './cinematicGrade';
import { LOOK } from './lookConfig';
import { useLook } from './lookStore';

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
  /**
   * The cinematic grade and AO are the Mini Earth's, not the whole game's.
   *
   * They are tuned for one strong sun over open landscape. Applying the same contrast curve and
   * vignette to a voxel fortress interior, which is lit completely differently, would be a
   * regression there — so the map that wants them turns them on while it is mounted.
   */
  const cinematic = isCinematicGrade();

  if (isLowTier || (!bloomEnabled && !cinematic)) return null;
  const g = LOOK.grade;

  return (
    // enableNormalPass only when AO is actually in the chain: it is an extra full-scene render of
    // the normals, and paying for it on every other map to use it on one would be careless.
    <EffectComposer multisampling={0} enableNormalPass={cinematic}>
      {bloomEnabled ? (
        <Bloom
          kernelSize={KernelSize.MEDIUM}
          intensity={bloomIntensity}
          luminanceThreshold={bloomThreshold}
          luminanceSmoothing={LOOK.bloom.luminanceSmoothing}
          radius={bloomRadius}
        />
      ) : <></>}
      {cinematic ? (
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={LOOK.ao.samples}
          rings={LOOK.ao.rings}
          intensity={LOOK.ao.intensity}
          radius={LOOK.ao.radius}
          luminanceInfluence={LOOK.ao.luminanceInfluence}
          worldDistanceThreshold={1}
          worldDistanceFalloff={1}
          worldProximityThreshold={1}
          worldProximityFalloff={1}
        />
      ) : <></>}
      {/* Contrast and saturation BEFORE the vignette, so the vignette darkens the graded image
          rather than being stretched by the contrast curve applied after it. */}
      {cinematic ? (
        <BrightnessContrast brightness={g.brightness} contrast={g.contrast} />
      ) : <></>}
      {cinematic ? (
        <HueSaturation hue={0} saturation={g.saturation} />
      ) : <></>}
      {cinematic ? (
        <Vignette offset={g.vignette.offset} darkness={g.vignette.darkness} eskil={false} />
      ) : <></>}
    </EffectComposer>
  );
}
