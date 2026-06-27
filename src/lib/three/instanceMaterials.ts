// instanceMaterials — tiny, game-agnostic helper for per-instance material lifecycle.
//
// Many creature renderers clone a cached glb's skeleton (SkeletonUtils.clone) and then clone its
// MATERIALS so each instance can carry independent uniforms / recolour shaders. Those cloned
// materials (and the GPU programs their onBeforeCompile builds) are NOT owned by the useGLTF cache,
// so when the instance unmounts they leak unless explicitly disposed. Geometries and any SHARED
// (un-cloned) materials stay owned by the cache and must be left intact.
//
// Usage:
//   const cloned = useMemo(() => {
//     const c = SkeletonUtils.clone(scene) as THREE.Group;
//     const mine: THREE.Material[] = [];
//     // ...clone + tweak per-instance materials, pushing each clone into `mine`...
//     trackInstanceMaterials(c, mine);          // remember only what THIS instance cloned
//     return c;
//   }, [scene]);
//   useDisposeInstanceMaterials(cloned);        // frees them on unmount / when `cloned` changes
//
// Used by both the Siege Worlds monster renderers and (in future) the Dreadroot enemies — keep it
// free of any game-specific logic.
import { useEffect } from 'react';
import type * as THREE from 'three';

const KEY = '__instanceMats';

/** Remember the per-instance (cloned) materials on a clone root so they can be disposed later.
 *  Pass ONLY materials you cloned for this instance — never shared/cached glb materials. */
export function trackInstanceMaterials(root: THREE.Object3D, mats: THREE.Material[]): void {
  (root.userData as Record<string, unknown>)[KEY] = mats;
}

/** Dispose a clone's tracked per-instance materials when it changes identity or the component
 *  unmounts. The cleanup closes over the specific `root` it ran for, so a re-clone disposes the
 *  OLD clone's materials (not the freshly-built ones). No-op when nothing was tracked. */
export function useDisposeInstanceMaterials(root: THREE.Object3D | null | undefined): void {
  useEffect(() => {
    if (!root) return;
    return () => {
      const mats = (root.userData as Record<string, unknown>)[KEY] as THREE.Material[] | undefined;
      if (mats) for (const m of mats) m.dispose();
    };
  }, [root]);
}
