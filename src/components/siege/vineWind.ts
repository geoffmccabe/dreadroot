// vineWind — slow procedural wind sway for the hanging vine/ivy strings on the giant mushroom trees
// (mushroomtree05/06 ship an `IVY` mesh under a `hangingvines` node). GPU-only (a vertex offset in
// onBeforeCompile, like the leaf-wind), so it's free per-frame. The sway is anchored at the top of
// each vine (where it meets the cap) and grows toward the tip, weighted by vertex height in the vine.
// Amplitude scales with the vine's own length, so a 100m mushroom's vines swing wide but slowly.
// Only the vine meshes get it — their material is CLONED first so the shared cap/trunk material is
// untouched. Drive one shared time uniform from any per-frame ticker via `vineTime.value = elapsed`.
import * as THREE from 'three';

export const vineTime = { value: 0 };
const VINE_RE = /ivy|hangingvine|\bvine|strand|tendril|drip/i;

function isVineMesh(m: THREE.Mesh): boolean {
  if (VINE_RE.test(m.name)) return true;
  let p: THREE.Object3D | null = m.parent;
  while (p) { if (VINE_RE.test(p.name)) return true; p = p.parent; }
  return false;
}

export function applyVineWind(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isVineMesh(mesh)) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const yMin = geo.boundingBox!.min.y, yMax = geo.boundingBox!.max.y;
    const amp = Math.max(0.02, (yMax - yMin) * 0.08);   // tip swings ~8% of the vine's length
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = Array.isArray(mesh.material)
      ? src.map((m) => windMat(m as THREE.Material, yMin, yMax, amp))
      : windMat(src[0] as THREE.Material, yMin, yMax, amp);
  });
}

function windMat(m: THREE.Material, yMin: number, yMax: number, amp: number): THREE.Material {
  const mat = m.clone() as THREE.MeshStandardMaterial;   // clone so cap/trunk (shared material) is untouched
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uTime = vineTime;
    shader.uniforms.uYMin = { value: yMin };
    shader.uniforms.uYMax = { value: yMax };
    shader.uniforms.uAmp = { value: amp };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uYMin; uniform float uYMax; uniform float uAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float vw = clamp((uYMax - position.y) / max(0.001, uYMax - uYMin), 0.0, 1.0);
        vw *= vw;                                    // more sway toward the tip
        float ph = position.x * 0.15 + position.z * 0.15;
        transformed.x += sin(uTime * 0.4 + ph) * uAmp * vw;         // slow (0.4 rad/s) primary sway
        transformed.z += cos(uTime * 0.33 + ph * 1.3) * uAmp * vw * 0.7;`);
  };
  mat.needsUpdate = true;
  return mat;
}
