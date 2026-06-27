// siegeTreeBark — recolor tree TRUNKS brown in-shader, without a re-export.
//
// The big Enchanted-Forest trees (Giant/Large/Medium/Small) bake trunk + canopy into ONE mesh that
// shares the green leaf atlas. Synty's separate bark texture (_TrunkTex) was dropped in the FBX→glTF
// convert, so the trunk renders green like the leaves.
//
// There is NO clean texture/UV/vertex-color separator left in the exported mesh (the trunk's UV band
// overlaps the leaves', and the Synty vertex mask was flattened to white on export). So instead we
// separate by GEOMETRY: a trunk fragment is both LOW (near the base) and CENTRAL (close to the model's
// vertical axis); canopy leaves splay HIGH and WIDE. We brown fragments that pass both tests, keeping
// the sampled luminance so the bark still has light/dark relief. This is a heuristic — a stray low,
// central leaf may tint and a wide low branch may stay green — but it cleanly browns the visible base
// trunk, which is the whole complaint, with zero geometry/material duplication and color-only risk.
//
// Scope to the real trees only (NOT the fern fronds, NOT the already-correct hollow Tree_Trunk model).
import * as THREE from 'three';

export const TRUNK_TREE_RE = /Tree_Giant|Tree_Large|Tree_Medium|Tree_Small/i;

/** Brown the trunk of a tree material, using the geometry's bounds to find the low/central column. */
export function applyTrunkBark(mat: THREE.Material, geometry: THREE.BufferGeometry): void {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cz = (bb.min.z + bb.max.z) * 0.5;
  const height = Math.max(0.001, bb.max.y - bb.min.y);
  const halfXZ = Math.max(bb.max.x - cx, bb.max.z - cz, 0.001);
  const trunkTopY = bb.min.y + height * 0.34;   // brown the lower ~third (above-base height)
  const trunkRadius = halfXZ * 0.24;            // …and only near the central axis (a column, not canopy)

  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uTrunkCenter = { value: new THREE.Vector3(cx, bb.min.y, cz) };
    shader.uniforms.uTrunkTopY = { value: trunkTopY };
    shader.uniforms.uTrunkRadius = { value: trunkRadius };
    // capture object-space position into a varying
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;\nuniform vec3 uTrunkCenter;\nuniform float uTrunkTopY;\nuniform float uTrunkRadius;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float _hMask = 1.0 - smoothstep(uTrunkTopY * 0.82, uTrunkTopY, vLocalPos.y);            // 1 low → 0 above
          float _rad = length(vec2(vLocalPos.x - uTrunkCenter.x, vLocalPos.z - uTrunkCenter.z));
          float _rMask = 1.0 - smoothstep(uTrunkRadius * 0.7, uTrunkRadius, _rad);                // 1 central → 0 wide
          float _m = _hMask * _rMask;
          if (_m > 0.01) {
            float _l = dot(diffuseColor.rgb, vec3(0.333));
            vec3 _bark = vec3(0.16, 0.085, 0.04) * (0.55 + 0.9 * _l);
            diffuseColor.rgb = mix(diffuseColor.rgb, _bark, _m);
          }
        }`,
      );
  };
  mat.needsUpdate = true;
}
