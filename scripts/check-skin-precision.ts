/**
 * check-skin-precision — a 1.8 m person, six thousand kilometres from the origin, must not shatter.
 *
 * Geoff: "in the SWW game we had 200-1000 zombies and they all animated and looked good... Why can't
 * we use the same structure?"
 *
 * We can, and this proves it without a browser. The skinning shader's arithmetic is reproduced here
 * EXACTLY — the same three matrix multiplies, narrowed to 32-bit floats at the same points the GPU
 * narrows them — and run twice: once the way three.js does it by default, once through
 * localiseSkinning. The default has to fail and the fix has to pass, or the theory is wrong and the
 * change is pointless.
 *
 * Run: npm run check:skin-precision
 */

import * as THREE from 'three';
import { localiseSkinning } from '../src/components/siege/globe/skinPrecision';
import { PLANET_RADIUS, METRES_PER_UNIT } from '../src/components/siege/globe/cubeSphere';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}

/**
 * Narrow a matrix to 32-bit, the way uploading it to the card does.
 *
 * This is the ONLY thing that makes this test meaningful. Left in 64-bit, every version of the maths
 * below is exact and nothing is learned.
 */
function toF32(m: THREE.Matrix4): THREE.Matrix4 {
  const out = new THREE.Matrix4();
  for (let i = 0; i < 16; i++) out.elements[i] = Math.fround(m.elements[i]);
  return out;
}
/** ...and the same for a vertex, which the shader also holds in 32-bit. */
function vecF32(v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));
}

/**
 * One figure: a root, one bone, one skinned mesh. Small, but it exercises the exact chain — three
 * matrices and a vertex — that the real shader runs for every vertex of every soldier.
 */
function buildFigure(heightUnits: number) {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'spine';
  root.add(bone);

  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([0, 0, 0, 0, heightUnits, 0, 0.1 * heightUnits, heightUnits * 0.5, 0]);
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(12), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(
    new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));

  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  root.add(mesh);
  root.updateMatrixWorld(true);
  // Bound at the origin, which is where a freshly loaded glTF sits — exactly as the crowd's clones
  // are bound before they are ever moved onto the planet.
  mesh.bind(new THREE.Skeleton([bone], [new THREE.Matrix4()]), mesh.matrixWorld);
  return { root, bone, mesh };
}

/**
 * Reproduce the shader, in 32-bit, and return where the vertex ENDS UP in model space.
 *
 *   skinVertex  = bindMatrix * local
 *   skinned     = boneMatrix * skinVertex
 *   transformed = bindMatrixInverse * skinned
 *
 * Perfect arithmetic returns exactly `local`, whatever the figure's world position. Everything this
 * test measures is the distance between what comes back and what went in.
 */
function shaderRoundTrip(mesh: THREE.SkinnedMesh, local: THREE.Vector3): number {
  mesh.skeleton.update();
  const boneMatrix = toF32(new THREE.Matrix4().fromArray(mesh.skeleton.boneMatrices, 0));
  const bindMatrix = toF32(mesh.bindMatrix);
  const bindInverse = toF32(mesh.bindMatrixInverse);

  const v = vecF32(local);
  v.applyMatrix4(bindMatrix);
  vecF32(v).copy(vecF32(v));            // narrow after each stage, as the GPU does
  const a = vecF32(v).applyMatrix4(boneMatrix);
  const b = vecF32(a).applyMatrix4(bindInverse);
  return vecF32(b).distanceTo(local);
}

const HEIGHT = 1.8 / METRES_PER_UNIT;        // a 1.8 m person, in game units
const HEAD = new THREE.Vector3(0, HEIGHT, 0);
const KAIJU_HEIGHT = 3;                       // 300 m

console.log('\n== A 1.8 m soldier, 6371 km from the origin ==\n');

// --- 1. AT THE WORLD ORIGIN, everything already works. This is SWW. ---------------------------
{
  const { mesh } = buildFigure(HEIGHT);
  const err = shaderRoundTrip(mesh, HEAD) * METRES_PER_UNIT;
  ok(err < 0.001, 'at the world origin a soldier is exact — this is why SWW never had the problem',
     `${(err * 1000).toFixed(3)} mm`);
}

// --- 2. ON THE PLANET, THE DEFAULT PATH SHATTERS ------------------------------------------------
// If this ever PASSES, the whole diagnosis is wrong and the fix below is cargo cult.
let defaultErr = 0;
{
  const { root, mesh } = buildFigure(HEIGHT);
  root.position.set(0, PLANET_RADIUS, 0);
  root.updateMatrixWorld(true);
  defaultErr = shaderRoundTrip(mesh, HEAD) * METRES_PER_UNIT;
  ok(defaultErr > 0.05,
     'the SAME soldier on the planet surface is wrong by a large fraction of himself',
     `${defaultErr.toFixed(3)} m of error on a 1.8 m body = ${(defaultErr / 1.8 * 100).toFixed(0)}%`);
}

// --- 3. ...AND THE FIX MAKES IT EXACT AGAIN -----------------------------------------------------
{
  const { root, mesh } = buildFigure(HEIGHT);
  root.position.set(0, PLANET_RADIUS, 0);
  root.updateMatrixWorld(true);
  const patched = localiseSkinning(root);
  ok(patched === 1, 'the fix finds and patches the skinned mesh', `${patched} mesh`);
  root.updateMatrixWorld(true);

  const err = shaderRoundTrip(mesh, HEAD) * METRES_PER_UNIT;
  ok(err < 0.005, 'on the planet surface, a localised soldier is exact again',
     `${(err * 1000).toFixed(3)} mm`);
  ok(err < defaultErr / 50, 'which is at least fifty times better than the default path',
     `${defaultErr.toFixed(3)} m -> ${(err * 1000).toFixed(3)} mm`);
}

// --- 4. IT MUST STILL BE CORRECT WHEN THE BONE ACTUALLY MOVES -----------------------------------
// An exact identity is easy to get right by accident. Animate the bone and the rebased matrices have
// to reproduce the real pose, not merely cancel to zero.
{
  const { root, bone, mesh } = buildFigure(HEIGHT);
  root.position.set(0, PLANET_RADIUS, 0);
  root.updateMatrixWorld(true);

  // Where the head should be after leaning the bone, computed in full 64-bit as the reference.
  bone.rotation.z = 0.4;
  bone.position.set(0.002, 0.001, 0);
  root.updateMatrixWorld(true);
  const expected = HEAD.clone().applyMatrix4(bone.matrixWorld)
    .applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());

  localiseSkinning(root);
  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  const boneMatrix = toF32(new THREE.Matrix4().fromArray(mesh.skeleton.boneMatrices, 0));
  const got = vecF32(HEAD).applyMatrix4(toF32(mesh.bindMatrix));
  vecF32(got).applyMatrix4(boneMatrix);
  const posed = vecF32(vecF32(HEAD).applyMatrix4(boneMatrix)).applyMatrix4(toF32(mesh.bindMatrixInverse));

  const err = posed.distanceTo(expected) * METRES_PER_UNIT;
  ok(err < 0.005, 'a POSED bone still lands where 64-bit maths says it should',
     `${(err * 1000).toFixed(3)} mm off the exact answer`);
}

// --- 5. WHY THE KAIJU NEVER LOOKED BROKEN --------------------------------------------------------
// Same error, 170 times bigger creature. Stated as a check so the asymmetry is on the record rather
// than being rediscovered next time something large looks fine and something small does not.
{
  const { root, mesh } = buildFigure(KAIJU_HEIGHT);
  root.position.set(0, PLANET_RADIUS, 0);
  root.updateMatrixWorld(true);
  const err = shaderRoundTrip(mesh, new THREE.Vector3(0, KAIJU_HEIGHT, 0)) * METRES_PER_UNIT;
  const asFraction = err / (KAIJU_HEIGHT * METRES_PER_UNIT);
  ok(asFraction < 0.005, 'the same flaw on a 300 m Kaiju is under half a percent — invisible',
     `${err.toFixed(2)} m on 300 m = ${(asFraction * 100).toFixed(2)}%`);
}

// --- 6. IDEMPOTENT --------------------------------------------------------------------------------
// The crowd rebuilds on every jump to a new battle site. Applying the fix twice must not compound.
{
  const { root, mesh } = buildFigure(HEIGHT);
  root.position.set(0, PLANET_RADIUS, 0);
  root.updateMatrixWorld(true);
  localiseSkinning(root);
  const second = localiseSkinning(root);
  root.updateMatrixWorld(true);
  ok(second === 0, 'applying the fix a second time is a no-op', `${second} meshes patched`);
  const err = shaderRoundTrip(mesh, HEAD) * METRES_PER_UNIT;
  ok(err < 0.005, 'and the figure is still exact afterwards', `${(err * 1000).toFixed(3)} mm`);
}

// --- 7. THE BOUNDING SPHERE STAYS LOCAL, WHICH IS WHAT FRUSTUM CULLING READS -------------------
//
// Localisation sets bindMatrixInverse to the identity. three.js has a SECOND path into the skeleton
// that does not know that — SkinnedMesh.applyBoneTransform — and left alone it returns a WORLD-space
// position. computeBoundingSphere is built on it, so the sphere lands six thousand kilometres from
// the mesh and every figure fails the frustum test: an entire crowd invisible, still firing, still
// audible, with no error anywhere. It hid until frustum culling was switched back on.
//
// This is the guard. The sphere has to describe a 1.8 m man near his own origin, wherever on the
// planet he is standing.
{
  const { root, mesh } = buildFigure(HEIGHT);
  root.position.set(0, PLANET_RADIUS, 0);
  root.updateMatrixWorld(true);
  localiseSkinning(root);
  root.updateMatrixWorld(true);

  const sphere = (mesh as THREE.SkinnedMesh).boundingSphere;
  ok(sphere != null, 'a localised figure is given a bounding sphere');
  if (sphere) {
    const centreM = sphere.center.length() * METRES_PER_UNIT;
    const radiusM = sphere.radius * METRES_PER_UNIT;
    ok(centreM < 50, 'and its centre is on the man, not on the planet',
       `${centreM.toFixed(2)} m from his own origin`);
    ok(radiusM > 0.5 && radiusM < 50, 'and it is a person-sized sphere',
       `radius ${radiusM.toFixed(2)} m`);
  }

  // ...and the transform it is built from returns LOCAL coordinates too, which is the actual fix.
  const v = new THREE.Vector3();
  (mesh as THREE.SkinnedMesh).getVertexPosition(1, v);
  ok(v.length() * METRES_PER_UNIT < 50, 'a posed vertex reads back in local space, not world',
     `${(v.length() * METRES_PER_UNIT).toFixed(2)} m from the origin`);
}

console.log(`\n${failures === 0 ? 'SKIN PRECISION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
