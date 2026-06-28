// siegeTreeBark — restore brown tree/fern-tree TRUNKS in-shader, without a re-export.
//
// Synty's vegetation models (Tree_Giant/Large/Medium/Small + Fern_Tree) bake trunk + canopy into ONE
// mesh driven by a custom two-texture shader: leaves sample the green leaf atlas, the trunk samples a
// separate bark atlas (PolygonNatureBiomesS2_Texture_01). The FBX→glTF convert collapsed that to a
// single PBR material keeping only the leaf atlas, so every trunk fragment samples the leaves —
// big-tree trunks render GREEN, and fern-tree trunks sample the alpha-cut leaf texture and vanish
// entirely (the "fern trees with no trunk / floating top" complaint).
//
// The Synty trunk/leaf mask was NOT lost: it survives verbatim in the second vertex-colour set,
// COLOR_1.b (glTF attribute `color_1`). It is cleanly bimodal — b≈0 = trunk, b≈1 = leaf. So we drive
// a real split in-shader: trunk fragments sample the bark atlas (opaque), leaf fragments keep the
// alpha-cut leaf atlas. Verified offline against both a big tree and a fern tree before shipping.
//
// Scope (caller-gated by TRUNK_TREE_RE): trees + fern-trees only. NOT vines (their COLOR_1 is 100%
// "trunk" so they'd turn entirely to bark), NOT Tree_Trunk/Tree_Portal/Roots (already bark-textured),
// NOT Tree_House (its own Branches atlas).
import * as THREE from 'three';

export const TRUNK_TREE_RE = /Tree_Giant|Tree_Large|Tree_Medium|Tree_Small|Fern_Tree/i;

/** Re-split a vegetation material so COLOR_1.b<=0.5 fragments sample the bark atlas, opaque. */
export function applyTrunkBark(mat: THREE.Material, barkTex: THREE.Texture): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uBark = { value: barkTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color_1;\nvarying float vTrunk;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrunk = step(color_1.b, 0.5);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uBark;\nvarying float vTrunk;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (vTrunk > 0.5) {
          vec4 _bk = texture2D(uBark, vMapUv);   // bark atlas is sRGB → hardware-decoded to linear
          diffuseColor.rgb = _bk.rgb;
          diffuseColor.a = 1.0;                  // trunk is opaque (survives the leaf alpha-cutout)
        }`,
      );
  };
  mat.needsUpdate = true;
}
