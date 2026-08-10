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
import { useGlobeActive } from './globeActive';

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
  /**
   * BOTH conditions, and the second one is the bug that broke every other map.
   *
   * `enabled` is a PERSISTED setting — it stays true across maps and sessions, which is what makes
   * the panel worth having. But this composer is global, so checking it alone applied the Mini
   * Earth's grade to Siege Worlds and everywhere else the instant the panel was switched on.
   * Contrast raised on a scene that was never graded for it is exactly "blown out".
   */
  // Called unconditionally, then combined. A hook inside a && chain is only reached when the terms
  // before it are true, which is a different number of hooks per render and a React crash.
  const globeOnScreen = useGlobeActive();
  const grade = g.enabled && g.gradeOn && globeOnScreen;

  if (isLowTier || (!bloomEnabled && !grade)) return null;

  return (
    /*
      KEYED ON WHICH EFFECTS EXIST, and this is the "white sky until I click contrast" bug.

      Geoff: "the whole sky remains pure white with some black dots until I click the contrast
      slider. When I click the contrast slider, even without adjusting it, then suddenly the sky
      turns black with white stars like it should be."

      That is a rebuild, not a value. EffectComposer compiles its effects into a single merged
      shader pass; conditionally adding or removing children does not reliably force it to rebuild
      that pass, so the grade would sit in the tree doing nothing until ANY prop change knocked the
      pass over and it recompiled — which is exactly what touching a slider does, whether or not the
      value moves.

      Keying on the SET of effects present makes turning the grade on a remount, so the pass is
      rebuilt the moment it needs to be. The key deliberately does not include the slider values:
      those flow through as uniforms and must not cause a rebuild, or every drag would recompile a
      shader.
    */
    <EffectComposer key={`${bloomEnabled ? 'b' : ''}${grade ? 'g' : ''}`} multisampling={0}>
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
