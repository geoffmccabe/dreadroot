// siegeTreeBark — recolor tree TRUNKS brown in-shader, without a re-export.
//
// The big Enchanted-Forest trees (Giant/Large/Medium/Small) bake trunk + canopy into ONE mesh that
// shares the green leaf atlas. Synty's separate bark texture (_TunkTex) was dropped in the FBX→glTF
// convert, so the trunk — which samples the LOWER band of the atlas (V < ~0.7) — renders green like
// the leaves. The canopy samples the TOP band (V >= ~0.7) and is correctly green.
//
// Fix: in the fragment stage, tint only the low-V (trunk/branch) fragments to bark-brown, keeping
// the texture's luminance so the bark still has light/dark relief. The canopy is untouched. This is
// a per-fragment UV test — a couple of ALU ops, no geometry/material duplication.
//
// Scope to the real trees only (NOT the fern fronds, which have no trunk and an inverted UV layout,
// and NOT the already-correct hollow Tree_Trunk model).
import * as THREE from 'three';

export const TRUNK_TREE_RE = /Tree_Giant|Tree_Large|Tree_Medium|Tree_Small/i;

export function applyTrunkBark(mat: THREE.Material): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
        // Trunk/branch fragments sample the lower atlas band → recolor to bark-brown, modulated by
        // the sampled luminance so bark keeps its relief. Canopy (V >= 0.7) is left as the leaf texture.
        if (vMapUv.y < 0.70) {
          float _l = dot(diffuseColor.rgb, vec3(0.333));
          diffuseColor.rgb = vec3(0.16, 0.085, 0.04) * (0.55 + 0.9 * _l);
        }`,
    );
  };
  mat.needsUpdate = true;
}
