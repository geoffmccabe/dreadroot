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
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { KernelSize } from 'postprocessing';
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

  if (isLowTier || !bloomEnabled) return null;

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        kernelSize={KernelSize.MEDIUM}
        intensity={bloomIntensity}
        luminanceThreshold={bloomThreshold}
        luminanceSmoothing={LOOK.bloom.luminanceSmoothing}
        radius={bloomRadius}
      />
    </EffectComposer>
  );
}
