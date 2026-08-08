// skinPrecision — why 1.8 m people shatter on a planet, and the one-line-per-mesh cure.
//
// Geoff: "the 1.8m humans look like sparkling random geometric shapes... in the SWW game we had
// 200-1000 zombies and they all animated and looked good and had equal complexity. Why can't we use
// the same structure?"
//
// We can. The models, the animation system and the clone-per-figure structure are all identical to
// SWW's. The only difference is HOW FAR FROM THE WORLD'S ORIGIN they stand, and that turns out to
// decide whether skeletal animation works at all.
//
// THE PROBLEM
// -----------
// A graphics card stores positions as 32-bit floats: about seven significant digits. That is a
// RELATIVE precision, so the absolute error grows with the size of the number:
//
//     SWW zombie          ~1 km from the world centre    ->  0.06 mm of error   (0.003% of a person)
//     Mini Earth soldier  6371 km from the world centre  ->  0.38 m of error    (21% of a person)
//
// Everything else in this scene survives that, because three.js multiplies world transforms on the
// CPU in 64-bit and only ever hands the card a CAMERA-RELATIVE matrix — small numbers. Terrain,
// buildings, bullets: all fine.
//
// SKINNED MESHES ARE THE EXCEPTION, and it is structural rather than an oversight. The skinning
// shader is handed each bone's matrix in WORLD space and does, per vertex:
//
//     skinVertex  = bindMatrix * localPosition        // model space  -> bind world space
//     skinned     = boneMatrix * skinVertex           // bind world   -> current world   <-- HUGE
//     transformed = bindMatrixInverse * skinned       // current world-> model space
//
// The middle line evaluates a full world-space position — six million metres — in 32-bit float. The
// third line subtracts it back off, but the damage is done: every vertex has picked up a third of a
// metre of noise. On a 300 m Kaiju that is 0.13% and invisible. On a 1.8 m soldier it is a fifth of
// his height, applied independently to every vertex, changing every frame. That is precisely
// "a rapidly blurring bunch of random triangles".
//
// THE CURE
// --------
// Hand the card those same bones measured from the FIGURE'S OWN FEET instead of from the planet's
// centre. The chain becomes model space -> model space, every number is about 1.8, and the figure's
// actual position on the planet is applied afterwards by the CPU-side matrix that was always
// accurate. Same skeleton, same clips, same everything — the numbers are just small again.
//
// The rebasing multiply happens here, in JavaScript, in 64-bit. That is the whole trick: do the
// enormous subtraction where there is precision to do it in, and give the card only the difference.

import * as THREE from 'three';

/** Live counts, so "did the fix actually apply?" is answered by looking rather than assuming. */
export const skinPrecisionDiag = { meshes: 0, bones: 0 };

const _identity = new THREE.Matrix4();

/**
 * Re-base every skinned mesh under `root` into its own local space.
 *
 * Call ONCE per cloned figure, after cloning and before the first render. Idempotent: a mesh already
 * localised is skipped, so calling it twice cannot double-apply the transform.
 *
 * Safe to use on anything skinned; it changes no visible geometry, only the arithmetic path.
 */
export function localiseSkinning(root: THREE.Object3D): number {
  let patched = 0;
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    const skeleton = mesh.skeleton as THREE.Skeleton & { _localised?: boolean };
    if (skeleton._localised) return;
    skeleton._localised = true;

    // The ORIGINAL bind matrix, captured before it is replaced. It maps model space to the world
    // space the mesh was bound in, and the rebased bone matrices have to undo it.
    const bind = mesh.bindMatrix.clone();

    // DETACHED, with an identity bind. In attached mode three.js rewrites bindMatrixInverse to the
    // mesh's world matrix every frame — reintroducing exactly the huge numbers being removed. In
    // detached mode it derives it from bindMatrix, which is now the identity, so both ends of the
    // shader's chain are neutral and the bone matrices below carry the whole transform.
    mesh.bindMode = 'detached' as THREE.SkinnedMesh['bindMode'];
    mesh.bindMatrix.identity();
    mesh.bindMatrixInverse.identity();

    const worldInverse = new THREE.Matrix4();
    const scratch = new THREE.Matrix4();

    // Replace this skeleton's update. Same contract as three.js's own — fill boneMatrices, flag the
    // texture — but every matrix is composed in 64-bit here and only the small result is uploaded.
    //
    //   boneMatrix = meshWorld^-1 * bone.matrixWorld * boneInverse * originalBindMatrix
    //
    // Read right to left: model space -> bind world -> bone space -> current world -> model space.
    // The two world-scale terms are adjacent, so their product is taken at full double precision and
    // the six-million-metre component cancels before anything is narrowed to 32 bits.
    skeleton.update = function localisedUpdate(this: THREE.Skeleton) {
      worldInverse.copy(mesh.matrixWorld).invert();
      const bones = this.bones;
      const boneInverses = this.boneInverses;
      const out = this.boneMatrices;
      for (let i = 0, n = bones.length; i < n; i++) {
        const boneWorld = bones[i] ? bones[i].matrixWorld : _identity;
        scratch.multiplyMatrices(worldInverse, boneWorld);
        scratch.multiply(boneInverses[i]);
        scratch.multiply(bind);
        scratch.toArray(out, i * 16);
      }
      if (this.boneTexture !== null) this.boneTexture.needsUpdate = true;
    };

    patched++;
    skinPrecisionDiag.bones += skeleton.bones.length;
  });
  skinPrecisionDiag.meshes += patched;
  return patched;
}
