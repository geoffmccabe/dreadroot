// crowdBake — bake a walk cycle into a texture so a whole crowd draws in ONE call.
//
// This is the standard way crowds are rendered, and it is the right answer to "make it light".
//
// The problem: a skinned character costs a draw call and a skeleton update per copy. Two hundred
// of them is two hundred of each, every frame, which is exactly the thing you cannot afford in a
// scene that is already streaming a planet.
//
// The technique: an animation is a deterministic function of time, so it can be evaluated ONCE,
// offline, and stored. We sample the skinned mesh at a handful of moments through the walk cycle,
// write every vertex position at every moment into a texture, and then draw all two hundred
// figures as a single instanced mesh whose vertex shader looks up "where is vertex V at time T"
// and blends between the two nearest samples.
//
// What that buys:
//   ONE draw call instead of 200
//   ZERO skeleton updates per frame — the CPU does nothing but move the instances
//   every figure at a different point in the cycle, because the time is per-instance
//
// The cost is a texture of a few megabytes and a one-off bake at load. That is the correct trade
// for a crowd: pay once, in memory, instead of every frame, in CPU and draw calls.

import * as THREE from 'three';

/** Samples through the cycle. 24 is smooth for a walk; the texture cost scales with this. */
export const BAKE_FRAMES = 24;

export interface BakedCrowd {
  geometry: THREE.BufferGeometry;
  /** RGB float texture: x = vertex, y = frame, value = position in the model's own space. */
  texture: THREE.DataTexture;
  vertexCount: number;
  frames: number;
  /** Height of the model in its own units, so instances can be scaled to a real person. */
  modelHeight: number;
}

/**
 * Sample a skinned mesh's deformed vertices at one moment.
 *
 * three.js does not expose skinned positions on the CPU, so this applies the skinning transform by
 * hand — the same four-bone weighted blend the GPU does — after the mixer and skeleton have been
 * brought to the requested time.
 */
function readSkinnedPositions(mesh: THREE.SkinnedMesh, out: Float32Array, offset: number): void {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const skinIndex = geo.attributes.skinIndex;
  const skinWeight = geo.attributes.skinWeight;
  const skeleton = mesh.skeleton;

  const v = new THREE.Vector3();
  const temp = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const bone = new THREE.Matrix4();
  const bindMatrix = mesh.bindMatrix;
  const bindMatrixInverse = mesh.bindMatrixInverse;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(bindMatrix);
    acc.set(0, 0, 0);

    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(i, k);
      if (w === 0) continue;
      const bi = skinIndex.getComponent(i, k);
      bone.fromArray(skeleton.boneMatrices, bi * 16);
      temp.copy(v).applyMatrix4(bone).multiplyScalar(w);
      acc.add(temp);
    }

    acc.applyMatrix4(bindMatrixInverse);
    const o = offset + i * 3;
    out[o] = acc.x; out[o + 1] = acc.y; out[o + 2] = acc.z;
  }
}

/**
 * Bake `clip` on `source` into a position texture.
 *
 * Returns null if the model has no skinned mesh, in which case the caller should fall back rather
 * than render nothing — a crowd that silently vanishes is worse than a crude one.
 */
export function bakeCrowd(
  source: THREE.Object3D, clip: THREE.AnimationClip | null,
): BakedCrowd | null {
  // Take the mesh with the most vertices: on a character that is reliably the body rather than
  // hair, eyes or kit.
  let mesh: THREE.SkinnedMesh | null = null;
  let best = 0;
  source.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const n = m.geometry.attributes.position?.count ?? 0;
    if (n > best) { best = n; mesh = m; }
  });
  if (!mesh || !clip) return null;

  const skinned = mesh as THREE.SkinnedMesh;
  const vertexCount = skinned.geometry.attributes.position.count;
  const data = new Float32Array(vertexCount * BAKE_FRAMES * 3);

  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(clip);
  action.play();

  for (let f = 0; f < BAKE_FRAMES; f++) {
    // Step to an absolute time rather than accumulating, so rounding cannot drift the loop.
    action.time = (f / BAKE_FRAMES) * clip.duration;
    mixer.update(0);
    source.updateMatrixWorld(true);
    skinned.skeleton.update();
    readSkinnedPositions(skinned, data, f * vertexCount * 3);
  }
  action.stop();
  mixer.uncacheClip(clip);

  // One texel per vertex per frame. Float RGB so positions survive without quantising.
  const texture = new THREE.DataTexture(
    data, vertexCount, BAKE_FRAMES, THREE.RGBFormat, THREE.FloatType,
  );
  texture.needsUpdate = true;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  // Measure the baked height, so instances can be scaled to a real 1.8 m person regardless of what
  // units the artist worked in.
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const y = data[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // A bare geometry carrying only what the shader needs: the vertex INDEX, plus normals and uvs
  // for shading. Positions come from the texture, so the attribute is a placeholder.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', skinned.geometry.attributes.position.clone());
  if (skinned.geometry.attributes.normal) {
    geometry.setAttribute('normal', skinned.geometry.attributes.normal.clone());
  }
  if (skinned.geometry.attributes.uv) {
    geometry.setAttribute('uv', skinned.geometry.attributes.uv.clone());
  }
  if (skinned.geometry.index) geometry.setIndex(skinned.geometry.index.clone());

  const vertexId = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) vertexId[i] = i;
  geometry.setAttribute('aVertexId', new THREE.BufferAttribute(vertexId, 1));

  return {
    geometry,
    texture,
    vertexCount,
    frames: BAKE_FRAMES,
    modelHeight: Math.max(0.01, maxY - minY),
  };
}

/**
 * A material that reads its vertex positions out of the baked texture.
 *
 * Built by patching a standard material rather than writing one from scratch, so it keeps the
 * engine's lighting, fog and tone mapping and cannot drift away from how everything else looks.
 */
export function makeCrowdMaterial(baked: BakedCrowd, base?: THREE.Texture | null): THREE.Material {
  const mat = new THREE.MeshLambertMaterial({ map: base ?? null, color: base ? 0xffffff : 0xb9a88c });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPose = { value: baked.texture };
    shader.uniforms.uVertexCount = { value: baked.vertexCount };
    shader.uniforms.uFrames = { value: baked.frames };

    shader.vertexShader = `
      uniform sampler2D uPose;
      uniform float uVertexCount;
      uniform float uFrames;
      attribute float aVertexId;
      attribute float aPhase;     // 0..1 where this instance is in the cycle
      attribute float aMoving;    // 1 walking, 0 standing still

      vec3 poseAt(float frame) {
        float x = (aVertexId + 0.5) / uVertexCount;
        float y = (mod(frame, uFrames) + 0.5) / uFrames;
        return texture2D(uPose, vec2(x, y)).xyz;
      }
    ` + shader.vertexShader;

    // Replace the position the vertex stage starts from. Blending the two nearest samples is what
    // lets 24 baked frames read as smooth motion instead of as a flipbook.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      float framePos = aPhase * uFrames;
      vec3 poseA = poseAt(floor(framePos));
      vec3 poseB = poseAt(floor(framePos) + 1.0);
      vec3 walked = mix(poseA, poseB, fract(framePos));
      // Standing still holds the first frame rather than freezing mid-stride.
      vec3 transformed = mix(poseAt(0.0), walked, aMoving);
      `,
    );
  };
  // Patched materials need a distinct key or three.js reuses another material's compiled program.
  mat.customProgramCacheKey = () => 'kaiju-crowd-vat';
  return mat;
}
