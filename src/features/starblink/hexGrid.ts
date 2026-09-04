// hexGrid — pointy-top hexagon lattice in axial coordinates, and the conversions between
// a parcel and a world position. Pure maths, no rendering and no three.js, so it can be
// unit-tested and reused by the server when parcels become real records.
//
// Axial (q, r) maps to cube (x, y, z) = (q, -q-r, r), which is what makes the ring number
// fall straight out as (|x| + |y| + |z|) / 2. Reference convention: Red Blob Games.

import { HEX_ACROSS_FLATS_M, HEX_CIRCUMRADIUS_M, WORLD_RINGS } from './worldConfig';

export interface Hex { q: number; r: number }

/** Key for map/set storage. Safe well beyond +/-173 rings. */
export const hexKey = (q: number, r: number) => (q + 8192) * 65536 + (r + 8192);

/** The 6 neighbours, in order, starting east and going counter-clockwise. */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export const neighbor = (h: Hex, dir: number): Hex => ({
  q: h.q + HEX_DIRECTIONS[dir].q,
  r: h.r + HEX_DIRECTIONS[dir].r,
});

/** Ring number: how many parcels out from the centre. Ring 0 is the centre parcel. */
export function hexRing(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2;
}

/** Parcels between two hexes, counted in steps. */
export function hexDistance(a: Hex, b: Hex): number {
  return hexRing(a.q - b.q, a.r - b.r);
}

/** Is this parcel inside the world's giant hexagon? */
export const inWorld = (q: number, r: number) => hexRing(q, r) <= WORLD_RINGS;

/** Parcel centre in world metres (XZ plane; Y is the terrain's business, not the grid's). */
export function hexToWorld(q: number, r: number): { x: number; z: number } {
  return {
    x: HEX_CIRCUMRADIUS_M * Math.sqrt(3) * (q + r / 2),
    z: HEX_CIRCUMRADIUS_M * 1.5 * r,
  };
}

/** World metres to the parcel containing that point. */
export function worldToHex(x: number, z: number): Hex {
  const q = (Math.sqrt(3) / 3 * x - z / 3) / HEX_CIRCUMRADIUS_M;
  const r = (2 / 3 * z) / HEX_CIRCUMRADIUS_M;
  return axialRound(q, r);
}

/** Nearest whole parcel to fractional axial coords (round in cube space, fix the worst axis). */
export function axialRound(qf: number, rf: number): Hex {
  const yf = -qf - rf;
  let q = Math.round(qf), y = Math.round(yf), r = Math.round(rf);
  const dq = Math.abs(q - qf), dy = Math.abs(y - yf), dr = Math.abs(r - rf);
  if (dq > dy && dq > dr) q = -y - r;
  else if (dy > dr) y = -q - r;
  else r = -q - y;
  return { q, r };
}

/**
 * The 6 corners of a parcel, relative to its centre, in world metres. Pointy-top, so the
 * first corner points north and they run clockwise looking down the +Y axis.
 */
export const HEX_CORNERS: readonly { x: number; z: number }[] = Array.from({ length: 6 }, (_, i) => {
  const a = Math.PI / 180 * (60 * i - 90);
  return { x: HEX_CIRCUMRADIUS_M * Math.cos(a), z: HEX_CIRCUMRADIUS_M * Math.sin(a) };
});

/** Every parcel within `rings` of `centre` that is also inside the world. */
export function hexesWithin(centre: Hex, rings: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -rings; dq <= rings; dq++) {
    const lo = Math.max(-rings, -dq - rings);
    const hi = Math.min(rings, -dq + rings);
    for (let dr = lo; dr <= hi; dr++) {
      const q = centre.q + dq, r = centre.r + dr;
      if (inWorld(q, r)) out.push({ q, r });
    }
  }
  return out;
}

/** Sanity: neighbour centres are exactly HEX_ACROSS_FLATS_M apart. Used by the self-check. */
export function neighbourSpacing(): number {
  const a = hexToWorld(0, 0), b = hexToWorld(1, 0);
  return Math.hypot(a.x - b.x, a.z - b.z);
}
export const EXPECTED_SPACING = HEX_ACROSS_FLATS_M;
