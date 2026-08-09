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
      {/*
        SSAO IS GONE, and it cannot come back in this form.
        Geoff: "everything flashes when I look around, everything is bright white."
        Screen-space AO reads the DEPTH BUFFER, and this scene's depth buffer is unusable for it.
        The globe camera sets its near plane from height above ground — as little as 3 cm — and its
        far plane from the horizon distance, which from orbit is hundreds of thousands of units.
        A depth range of ten million to one leaves almost no precision anywhere, so the AO pass
        samples noise: hence flashing that changes as the camera turns, because near and far are
        recomputed every frame as you look around.
        It was also the likely cause of the stall on load — enableNormalPass renders the entire
        scene a second time for its normals, and this scene is a streaming planet.
        The cavity shading in terrainMaterial does the same job for free and in world space, where
        the precision problem does not exist.
      */}
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
