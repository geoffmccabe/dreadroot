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
import { mergeBufferGeometries, SkeletonUtils } from 'three-stdlib';

/** Length of a rifle as a fraction of the man holding it. An AK is 0.88 m; a soldier is 1.8 m. */
const RIFLE_FRAC = 0.49;
/**
 * How far along the rifle, from the butt, the trigger hand grips it.
 *
 * A real AK's pistol grip is about 0.30 of the way along. 0.42 here on purpose: these poses extend
 * the arm well forward of the body, so at the true fraction the whole weapon floats out at arm's
 * length with nothing behind the hand. Sliding the grip back puts the stock in toward the shoulder,
 * which is what a rifle held by a person looks like. Checked against a render, not guessed.
 */
const GRIP_FRAC = 0.42;

export interface SoldierTemplate {
  /** A root holding the armature and one merged SkinnedMesh. Clone this per figure. */
  root: THREE.Group;
  /** Height of the model in its own units, measured from the POSED mesh rather than assumed. */
  height: number;
  /** How many draw calls one figure now costs. Logged so a regression here is visible. */
  parts: number;
  /** Whether a weapon was welded in. False means the merge or the rig lookup declined. */
  hasRifle: boolean;
}

/** Attributes kept on the merged geometry. Anything else differs between parts and blocks the merge. */
const KEEP = ['position', 'normal', 'skinIndex', 'skinWeight'] as const;

/**
 * Build the one-draw-call soldier, or null if this model cannot be merged safely.
 *
 * WORKS ON A CLONE, ALWAYS. An earlier version read the loader's cached scene directly and then
 * REPARENTED its armature into the new root — quietly gutting the very thing useGLTF hands to the
 * next caller. It survived because the app only built one template per page load; the moment
 * anything built a second (a scripted render, or the crowd re-forming at a new battle site, which it
 * does on every jump) the second one came back with no skeleton, no rifle and no error. Found by
 * rendering the result instead of trusting it.
 */
export function buildSoldierTemplate(
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[] = [],
  rifle?: THREE.Object3D | null,
): SoldierTemplate | null {
  const source = SkeletonUtils.clone(scene);
  source.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  source.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
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

  // ASSEMBLE THE BODY FIRST, and measure it. Everything about the rifle is expressed as a fraction
  // of the man carrying it, and the ONLY trustworthy height is the one taken off the assembled,
  // posed mesh. The bind-space geometry is in a different space entirely — this export puts a factor
  // of a hundred between them — and sizing the weapon against that produced a rifle in exactly the
  // right hand, five hundred times too small. Measured by scripts/render-soldier, not by eye.
  const bodyMerged = mergeBufferGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!bodyMerged) return null;

  const probeMesh = new THREE.SkinnedMesh(bodyMerged, new THREE.MeshBasicMaterial());
  const holder = new THREE.Group();
  holder.add(source);
  holder.add(probeMesh);
  holder.updateMatrixWorld(true);
  probeMesh.bind(meshes[0].skeleton, new THREE.Matrix4());
  probeMesh.computeBoundingBox();
  const height = probeMesh.boundingBox
    ? Math.max(1e-4, probeMesh.boundingBox.max.y - probeMesh.boundingBox.min.y)
    : 1;

  // --- THE RIFLE -------------------------------------------------------------------------------
  //
  // Geoff: "Put a rifle in their hands and have them animate it and aim/fire it when they're
  // shooting." The model ships with Idle_Gun, Run_Shoot and Gun_Shoot but NO WEAPON — the animations
  // were authored around a gun that is not in the file.
  //
  // It is welded into the same geometry rather than parented to the hand as a second object, and
  // that is the whole reason this stays at one draw call: the rifle's vertices are simply skinned
  // 100% to the wrist bone, so every clip moves it exactly as it moves the hand, for free.
  //
  // WHERE IT GOES IS MEASURED FROM THE RIG, not typed in as offsets. Hand-tuned grip numbers are
  // the standard way this goes wrong: right for one model and quietly wrong for the next. Instead
  // the character is posed into Idle_Gun and asked where its hands ended up — the line from the
  // trigger hand to the supporting hand IS the barrel, because that is what holding a rifle means.
  let rifleGeo: THREE.BufferGeometry | null = null;
  if (rifle) {
    const wristIndex = bones.findIndex((b) => /^wrist_?r$/i.test(b.name));
    if (wristIndex >= 0) {
      rifleGeo = attachRifle(rifle, source, animations, meshes[0].skeleton, wristIndex, height);
    }
  }

  const merged = rifleGeo ? mergeBufferGeometries([bodyMerged, rifleGeo], false) : bodyMerged;
  if (rifleGeo) { bodyMerged.dispose(); rifleGeo.dispose(); }
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

  // KEEP THE WHOLE ORIGINAL HIERARCHY. Every ancestor above the bones carries a transform and this
  // export puts a factor of a hundred in one of them, so lifting the armature out into a bare group
  // silently drops it. Only the merged mesh is re-homed — to the root, at identity, which is the
  // space its vertices were baked into.
  holder.remove(probeMesh);
  const root = new THREE.Group();
  root.add(source);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(meshes[0].skeleton, new THREE.Matrix4());

  return { root, height, parts: 1, hasRifle: rifleGeo != null };
}


/**
 * Build the rifle's geometry, already placed in the character's bind space and skinned to one bone.
 *
 * Returns null rather than guessing if anything about the model is unexpected — a soldier with no
 * rifle is a disappointment, a soldier with a rifle through his head is a bug report.
 */
function attachRifle(
  rifle: THREE.Object3D,
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[],
  skeleton: THREE.Skeleton,
  wristIndex: number,
  height: number,
): THREE.BufferGeometry | null {
  // 1. POSE A THROWAWAY COPY into the stance the rifle has to suit — an AIMING one, because that is
  //    the pose in which "where should the barrel point" has an unambiguous answer. The copy matters:
  //    the loader caches the scene and anything else asking for this file must get it unposed.
  const probe = SkeletonUtils.clone(scene) as THREE.Object3D;
  const named = (re: RegExp) => animations.find((a) => re.test(a.name.split('|').pop() ?? ''));
  const pose = named(/^idle_?gun_?shoot$/i) ?? named(/^run_?shoot$/i)
    ?? named(/^gun_?shoot$/i) ?? named(/gun/i);
  if (pose) {
    const mixer = new THREE.AnimationMixer(probe);
    mixer.clipAction(pose).play();
    mixer.update(pose.duration * 0.5);
  }
  probe.updateMatrixWorld(true);

  const handR = probe.getObjectByName(skeleton.bones[wristIndex].name);
  if (!handR) return null;
  const gripPos = new THREE.Vector3().setFromMatrixPosition(handR.matrixWorld);
  const posedR = handR.matrixWorld.clone();

  // 2. THE BARREL POINTS WHERE THE CHARACTER IS FACING. That is what aiming MEANS, and it is the
  //    only definition that does not depend on the rig telling the truth about something else.
  //
  //    The first version derived it from the line between the two hands, on the reasoning that a
  //    rifle is held with both. Measurement killed that: in EVERY gun pose this model has, the hands
  //    are 0.52 to 0.78 m apart on a 1.79 m man — far too wide to both be on one weapon. These are
  //    stylised poses, not motion-captured rifle holds. Built on that false premise the barrel came
  //    out pointing across the soldier's chest and off to his left, which is what Geoff saw.
  //
  //    A palm frame from the finger bones was the other candidate and is not available either: every
  //    finger's base bone in this rig sits at the SAME point as the wrist, so there is no knuckle
  //    spread to take a direction from. The rig simply does not carry that information.
  //
  //    The model's local +Z is its front — the same convention every other renderer here uses when
  //    it maps local +Z to a heading — and the template root sits at identity, so world +Z is it.
  const barrel = new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(barrel, up).normalize();

  // 3. MERGE THE WEAPON'S OWN PARTS, flattening its four flat-coloured pieces into vertex colours
  //    exactly as the body was.
  rifle.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const colour = new THREE.Color();
  rifle.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    g.applyMatrix4(m.matrixWorld);
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    colour.copy(mat?.color ?? new THREE.Color(0.2, 0.2, 0.2));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = colour.r; col[i * 3 + 1] = colour.g; col[i * 3 + 2] = colour.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  });
  if (!parts.length) return null;
  const gun = mergeBufferGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!gun) return null;

  // 4. SIZE AND ORIENT IT. The weapon's longest axis is its barrel; which of the three that is gets
  //    measured rather than assumed, so swapping in a different gun model needs no code change.
  gun.computeBoundingBox();
  const bb = gun.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : (size.y >= size.z ? 'y' : 'z');
  const longest = size[axis];
  if (longest < 1e-6) return null;
  const scale = (height * RIFLE_FRAC) / longest;

  // Bring the gun's long axis to X...
  const toX = new THREE.Matrix4();
  if (axis === 'y') toX.makeRotationZ(-Math.PI / 2);
  else if (axis === 'z') toX.makeRotationY(Math.PI / 2);
  gun.applyMatrix4(toX);

  // ...AND WORK OUT WHICH END IS THE MUZZLE.
  //
  // Geoff: "The soldiers have their guns flipped around the wrong way." They were: the code mapped
  // the model's +X to the barrel direction, and on this AK the muzzle is at MINUS X — so every
  // soldier was aiming his own butt-stock at the monster.
  //
  // Rather than hard-code the flip for this one file, the muzzle is FOUND: a weapon is thin at the
  // muzzle and bulky at the receiver, so slicing it along its length and comparing the thickness of
  // the two ends says which way round it is. On this model the outer slices measure 0.06 at one end
  // against 0.44 at the other, which is not a close call. Any future weapon orients itself.
  if (!muzzleAtPlusX(gun)) gun.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));

  // ...then hold it GRIP_FRAC along its length FROM THE BUTT, which is where a hand actually goes
  // rather than at its centre of mass.
  gun.computeBoundingBox();
  const bb2 = gun.boundingBox!;
  const centre = bb2.getCenter(new THREE.Vector3());
  const local = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
  local.premultiply(new THREE.Matrix4().makeTranslation(longest * (0.5 - GRIP_FRAC), 0, 0));
  local.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));

  const frame = new THREE.Matrix4().makeBasis(barrel, up, side);
  frame.setPosition(gripPos);

  // 5. INTO BIND SPACE. The body's vertices live in the space the skeleton was bound in, and the
  //    rifle has to join them there — so the placement worked out in the POSED frame is expressed
  //    relative to the posed wrist and then re-applied to the bind wrist.
  const bindWrist = new THREE.Matrix4().copy(skeleton.boneInverses[wristIndex]).invert();
  const posedInverse = new THREE.Matrix4().copy(posedR).invert();
  const toBind = new THREE.Matrix4().multiplyMatrices(bindWrist, posedInverse);
  gun.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toBind, frame).multiply(local));

  // 6. WELD IT TO THE WRIST. One bone, full weight — a rigid prop, which is exactly what a rifle is.
  const n = gun.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const wgt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { idx[i * 4] = wristIndex; wgt[i * 4] = 1; }
  gun.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  gun.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4));
  return gun;
}

/**
 * Is this weapon's muzzle at +X? Assumes the long axis is already X.
 *
 * A gun is THIN where the barrel comes out and BULKY where the receiver, magazine and grip are, so
 * comparing how thick the two ends are answers it without knowing anything about the model. Measured
 * over the outer sixth at each end, which is far enough out to be past the receiver on anything
 * shaped like a firearm.
 */
function muzzleAtPlusX(geo: THREE.BufferGeometry): boolean {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return true;
  const len = bb.max.x - bb.min.x;
  if (len < 1e-9) return true;
  const edge = len / 6;
  const p = geo.attributes.position;
  let loY = 0, loZ = 0, hiY = 0, hiZ = 0;
  const loBox = new THREE.Box3(), hiBox = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.x < bb.min.x + edge) loBox.expandByPoint(v);
    else if (v.x > bb.max.x - edge) hiBox.expandByPoint(v);
  }
  if (loBox.isEmpty() || hiBox.isEmpty()) return true;
  const a = loBox.getSize(new THREE.Vector3()); loY = a.y; loZ = a.z;
  const b = hiBox.getSize(new THREE.Vector3()); hiY = b.y; hiZ = b.z;
  // Thinner end wins. Compared on area rather than either dimension alone, so a tall thin stock
  // cannot be mistaken for a barrel.
  return (hiY * hiZ) < (loY * loZ);
}
