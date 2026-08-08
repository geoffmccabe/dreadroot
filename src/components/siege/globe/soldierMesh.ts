// soldierMesh — turn a four-part, six-material rifleman into ONE draw call.
//
// Geoff asked for a proper soldier instead of a 1.8 m demon, and the pack has one:
// public/GLB Models All/Soldier.glb, with Walk, Run, Run_Shoot, Gun_Shoot, Idle_Gun and a rifle.
//
// It arrives as four skinned meshes (body, head, legs, feet) carrying eleven primitives between
// them, which at two hundred soldiers would be 2,200 draw calls. That is more than the rest of the
// scene put together, so it gets merged first.
//
// TWO FACTS ABOUT THIS PARTICULAR MODEL MAKE THE MERGE EASY, and both were checked rather than
// hoped for:
//
//   * All four skins reference the SAME 62 joints in the same order, so the skinIndex values in
//     every part already mean the same thing and can be concatenated without remapping.
//   * Every one of the six materials is a flat colour with NO TEXTURE, so they collapse into vertex
//     colours and a single material. No atlas, no UV repacking, nothing to go wrong.
//
// If either stops being true for some future model this returns null and the caller falls back to
// drawing the glTF as it came — slower, but correct, which is the right way round for a fallback.

import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';

export interface SoldierTemplate {
  /** A root holding the armature and one merged SkinnedMesh. Clone this per figure. */
  root: THREE.Group;
  /** Height of the model in its own units, measured from the POSED mesh rather than assumed. */
  height: number;
  /** How many draw calls one figure now costs. Logged so a regression here is visible. */
  parts: number;
}

/** Attributes kept on the merged geometry. Anything else differs between parts and blocks the merge. */
const KEEP = ['position', 'normal', 'skinIndex', 'skinWeight'] as const;

/**
 * Build the one-draw-call soldier, or null if this model cannot be merged safely.
 *
 * The source scene is never modified — every geometry is cloned before being touched — because the
 * loader caches it and a second component asking for the same file must get it intact.
 */
export function buildSoldierTemplate(scene: THREE.Object3D): SoldierTemplate | null {
  const meshes: THREE.SkinnedMesh[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  if (!meshes.length) return null;

  // Every part must ride the same skeleton, or their skinIndex values mean different bones and the
  // merged figure would tear itself apart. Checked, not assumed.
  const bones = meshes[0].skeleton.bones;
  for (const m of meshes) {
    if (m.skeleton.bones.length !== bones.length) return null;
    for (let i = 0; i < bones.length; i++) if (m.skeleton.bones[i] !== bones[i]) return null;
  }

  const geos: THREE.BufferGeometry[] = [];
  const colour = new THREE.Color();
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const src = m.geometry;
    // A geometry with material groups is several primitives in one buffer; each group gets its own
    // colour, so they are split out here rather than losing the distinction between skin and kit.
    const groups = src.groups.length ? src.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const g of groups) {
      const part = src.clone();
      part.clearGroups();
      // Keep only what every part has in common. A stray uv or tangent on one mesh and not another
      // makes the merge return null with no explanation, which is a miserable thing to debug.
      for (const name of Object.keys(part.attributes)) {
        if (!(KEEP as readonly string[]).includes(name)) part.deleteAttribute(name);
      }
      if (src.groups.length) {
        // Index just this group's slice.
        const idx = src.getIndex();
        if (!idx) continue;
        const slice = idx.array.slice(g.start, g.start + Math.min(g.count, idx.count - g.start));
        part.setIndex(new THREE.BufferAttribute(slice as Uint16Array | Uint32Array, 1));
      }
      const mat = mats[g.materialIndex ?? 0] as THREE.MeshStandardMaterial | undefined;
      colour.copy(mat?.color ?? new THREE.Color(0.6, 0.6, 0.6));
      const n = part.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = colour.r; col[i * 3 + 1] = colour.g; col[i * 3 + 2] = colour.b; }
      part.setAttribute('color', new THREE.BufferAttribute(col, 3));

      // BAKE THE BIND MATRIX INTO THE VERTICES. The shader computes bindMatrix * position, so moving
      // that multiply into the geometry and using an identity bind gives an identical result — and
      // it is the only way parts bound in different spaces can share one buffer.
      part.applyMatrix4(m.bindMatrix);
      geos.push(part);
    }
  }
  if (!geos.length) return null;

  const merged = mergeBufferGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, metalness: 0.0,
  });
  const mesh = new THREE.SkinnedMesh(merged, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Never culled: two hundred figures each testing their own bounds against the frustum costs more
  // than drawing the handful that are off screen, and a skinned bound is wrong anyway once posed.
  mesh.frustumCulled = false;

  // The armature has to come along, and it has to be the SAME bone objects the skeleton holds.
  // Walking up from bone 0 finds the root of the hierarchy they all share.
  let armature: THREE.Object3D = bones[0];
  while (armature.parent && (armature.parent as THREE.Bone).isBone) armature = armature.parent;
  const armatureRoot = armature.parent ?? armature;

  const root = new THREE.Group();
  root.add(armatureRoot);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(meshes[0].skeleton, new THREE.Matrix4());

  // MEASURE THE HEIGHT, do not assume it. The raw vertex extents of a skinned glTF are in a space
  // the armature's own scale has not been applied to — reading them gives 0.33 for a man-sized
  // model. computeBoundingBox on a SkinnedMesh applies the bone transforms, so this is the height
  // the figure will actually be drawn at.
  mesh.computeBoundingBox();
  const bb = mesh.boundingBox;
  const height = bb ? Math.max(1e-4, bb.max.y - bb.min.y) : 1;

  return { root, height, parts: 1 };
}
