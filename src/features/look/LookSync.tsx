// Applies live tone-mapping choice + exposure from lookStore to the renderer.
//
// The RENDERER owns tone mapping (both desktop and mobile) so exposure/mode are tunable
// everywhere; the desktop LookComposer then does bloom ONLY (no tone-map pass). Exposure
// is a uniform → instant. Changing the tone-mapping MODE bakes a different function into
// every material shader, so we force a one-time recompile of mounted materials on change
// (a brief hitch — fine for a debug/tuning panel).
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { type Material } from 'three';
import { useLook, TONE_MAPPING_THREE } from './lookStore';

export function LookSync() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const { toneMapping, exposure } = useLook();

  // Mode change → set renderer tone mapping + recompile existing materials.
  useEffect(() => {
    gl.toneMapping = TONE_MAPPING_THREE[toneMapping];
    scene.traverse((obj) => {
      const mat = (obj as { material?: Material | Material[] }).material;
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach((m) => (m.needsUpdate = true));
      else mat.needsUpdate = true;
    });
  }, [gl, scene, toneMapping]);

  // Exposure is a plain uniform — no recompile.
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);

  return null;
}
