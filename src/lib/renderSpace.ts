// renderSpace — the single boundary between WORLD coordinates (authoritative, what
// the server/DB/DO store and what gameplay math uses) and RENDER coordinates (what
// three.js meshes/camera live in). Today it is the IDENTITY: render == world. It
// exists so that the L123 plan's deferred "per-region origin shift" (to keep float32
// precision sane in very large worlds — e.g. Starblink at ±10 km, where float error
// starts to bite) becomes a change to THIS FILE ONLY, not a sweep across renderers.
//
// Rule (from the architecture plan): new rendering code that positions meshes/camera
// from world coordinates reads them through toRenderSpace(); anything writing a world
// position back from render space uses toWorldSpace(). Keep it allocation-free.

import type * as THREE from 'three';

/** Current render-space origin offset (world coords). Identity today. */
let originX = 0, originY = 0, originZ = 0;

/** Later: rebase the render origin near the player/region to preserve precision. */
export function setRenderOrigin(x: number, y: number, z: number): void {
  originX = x; originY = y; originZ = z;
}

export function getRenderOrigin(): [number, number, number] {
  return [originX, originY, originZ];
}

/** World → render. Writes into `out` (a Vector3) if given, else returns a tuple. */
export function toRenderSpace(x: number, y: number, z: number, out?: THREE.Vector3): [number, number, number] {
  const rx = x - originX, ry = y - originY, rz = z - originZ;
  if (out) out.set(rx, ry, rz);
  return [rx, ry, rz];
}

/** Scalar world→render per axis — allocation-free for hot loops (per-vertex terrain). */
export function toRenderX(x: number): number { return x - originX; }
export function toRenderY(y: number): number { return y - originY; }
export function toRenderZ(z: number): number { return z - originZ; }

/** Render → world (inverse of toRenderSpace). */
export function toWorldSpace(x: number, y: number, z: number): [number, number, number] {
  return [x + originX, y + originY, z + originZ];
}
