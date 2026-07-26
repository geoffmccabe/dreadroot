// cubeSphere — the coordinate maths for the Mini Earth globe map.
//
// ⚠ THIS FILE MUST STAY IN LOCKSTEP WITH scripts/earth/build_earth_tiles.py.
// The face basis vectors, the tile size and the u/v convention below are duplicated there.
// If one changes and the other does not, tiles silently land in the wrong place on the
// planet and every later bug will look like a rendering bug. See docs/MINI_EARTH_P1_BUILD.md.
//
// Model: the planet is a cube projected onto a sphere. Six faces, each subdivided as a
// quadtree. A face parameterises directions by (u, v) in [-1, 1]; normalising
// origin + u*uAxis + v*vAxis gives the unit direction of that point on the sphere.
//
// Pure functions only: no three.js state, no React, no allocation in the hot paths that
// matter (the *Into variants write into caller-owned arrays).

/** Samples per tile side: 256 quads plus a shared edge row/column so neighbours match exactly. */
export const TILE = 257;

/** Mean Earth radius in real metres. */
export const EARTH_RADIUS_M = 6371000;

/**
 * Real metres per game unit. THE scale convention for this map (see MINI_EARTH_PLAN.md §1).
 * Height tiles are stored in raw metres, so this is applied at load and can change without
 * regenerating a single tile.
 */
export const METRES_PER_UNIT = 100;

/** Planet radius in game units: 63,710. */
export const PLANET_RADIUS = EARTH_RADIUS_M / METRES_PER_UNIT;

/** Face order must match FACES in build_earth_tiles.py. */
export const FACE_NAMES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;
export type FaceName = (typeof FACE_NAMES)[number];

type Vec3 = readonly [number, number, number];
interface Face { origin: Vec3; u: Vec3; v: Vec3 }

/** origin / uAxis / vAxis per face, three.js coordinates (Y up). Mirrors the Python table. */
const FACES: readonly Face[] = [
  { origin: [1, 0, 0],  u: [0, 0, -1], v: [0, -1, 0] },  // px
  { origin: [-1, 0, 0], u: [0, 0, 1],  v: [0, -1, 0] },  // nx
  { origin: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, 1]  },  // py
  { origin: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, -1] },  // ny
  { origin: [0, 0, 1],  u: [1, 0, 0],  v: [0, -1, 0] },  // pz
  { origin: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },  // nz
];

/** Unit direction for a point on a face. `u`/`v` in [-1, 1]. Writes into `out`. */
export function faceUvToDirection(face: number, u: number, v: number, out: Float64Array | number[]): void {
  const f = FACES[face];
  const x = f.origin[0] + u * f.u[0] + v * f.v[0];
  const y = f.origin[1] + u * f.u[1] + v * f.v[1];
  const z = f.origin[2] + u * f.u[2] + v * f.v[2];
  const inv = 1 / Math.hypot(x, y, z);
  out[0] = x * inv; out[1] = y * inv; out[2] = z * inv;
}

/**
 * Which face a direction belongs to, and its (u, v) on that face. The dominant axis picks
 * the face; the other two components divided by it give u and v. Exact inverse of
 * faceUvToDirection.
 */
export function directionToFaceUv(x: number, y: number, z: number): { face: number; u: number; v: number } {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face: number;
  if (ax >= ay && ax >= az) face = x > 0 ? 0 : 1;
  else if (ay >= az) face = y > 0 ? 2 : 3;
  else face = z > 0 ? 4 : 5;

  // Project onto the face plane, then read off the u/v coefficients via the (orthonormal)
  // face axes. The axes are unit vectors along coordinate directions, so a dot product is
  // just picking the right component with the right sign.
  const f = FACES[face];
  const m = 1 / (ax >= ay && ax >= az ? ax : ay >= az ? ay : az);
  const px = x * m, py = y * m, pz = z * m;
  const u = px * f.u[0] + py * f.u[1] + pz * f.u[2];
  const v = px * f.v[0] + py * f.v[1] + pz * f.v[2];
  return { face, u, v };
}

/**
 * Y-up direction to geographic latitude/longitude in degrees. Matches the Python tiler.
 *
 * ⚠ NOTE THE MINUS ON X, here and in latLonToDirection. Without it the mapping is LEFT-handed
 * and the whole planet renders mirrored, with every continent backwards. It is an easy bug to
 * ship because it is self-consistent: sampling a known lat/lon still returns the right
 * elevation, so landmark spot-checks pass. The only test that catches it is handedness, that
 * (East, North, Up) forms a right-handed triad (E x N = U) as it does on Earth.
 */
export function directionToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI,
    lon: (Math.atan2(-x, -z) * 180) / Math.PI,
  };
}

/** Geographic latitude/longitude in degrees to a Y-up unit direction. Writes into `out`. */
export function latLonToDirection(lat: number, lon: number, out: Float64Array | number[]): void {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  const c = Math.cos(la);
  out[0] = -c * Math.sin(lo);
  out[1] = Math.sin(la);
  out[2] = -c * Math.cos(lo);
}

/** Which tile at `level` contains face coordinate `u` (or `v`) in [-1, 1]. */
export function uvToTileIndex(uv: number, level: number): number {
  const n = 1 << level;
  const t = Math.floor(((uv + 1) / 2) * n);
  return Math.max(0, Math.min(n - 1, t));
}

/** The [min, max] face-space u (or v) range a tile covers. */
export function tileUvRange(index: number, level: number): [number, number] {
  const n = 1 << level;
  return [-1 + (2 * index) / n, -1 + (2 * (index + 1)) / n];
}

/**
 * Arc length in game units of one tile edge at `level`. A full face spans a quarter of the
 * circumference, so level 0 is ~100,072 units and each level halves it. Used by the LOD
 * split test and to size skirt depth.
 */
export function tileArcUnits(level: number): number {
  return (PLANET_RADIUS * Math.PI) / 2 / (1 << level);
}

/** Distance between adjacent height samples at `level`, in game units (391 / 2^level). */
export function sampleSpacingUnits(level: number): number {
  return tileArcUnits(level) / (TILE - 1);
}

/**
 * World position of a surface point: the unit direction pushed out to the planet radius plus
 * the elevation. `elevationMetres` comes straight from a tile; the divide by METRES_PER_UNIT
 * is the one place raw metres become game units.
 */
export function surfacePosition(
  dx: number, dy: number, dz: number, elevationMetres: number, out: Float64Array | number[],
): void {
  const r = PLANET_RADIUS + elevationMetres / METRES_PER_UNIT;
  out[0] = dx * r; out[1] = dy * r; out[2] = dz * r;
}

/** Tile key for caches/maps: packs face, level and x/y into one string. */
export function tileKey(face: number, level: number, x: number, y: number): string {
  return `${face}/${level}/${x}_${y}`;
}
