// Pure voxel coordinate packing — NO React, NO Three.js — so it can be
// imported by the client collision grid AND by a Node/Cloudflare-DO chunk
// builder (Track 3). Extracted from spatialHashGrid.ts, which now imports +
// re-exports these so existing call sites are unchanged.
//
// Integer Morton-style packing (NEVER BigInt or strings — L123 plan perf
// trap #3). Strides are DERIVED from COORD_OFFSET so they stay in lockstep
// on any future change. Track 7 (coord-scale) swaps the scheme HERE, once.

export const COORD_OFFSET = 32768;
const COORD_RANGE = COORD_OFFSET * 2;                       // 65536
export const NUMPOSKEY_Y_STRIDE = COORD_RANGE;              // 65536
export const NUMPOSKEY_X_STRIDE = COORD_RANGE * COORD_RANGE; // 4_294_967_296

export const xzPosKey = (x: number, z: number): number =>
  (Math.floor(x) + COORD_OFFSET) * NUMPOSKEY_Y_STRIDE + (Math.floor(z) + COORD_OFFSET);

export const numPosKey = (x: number, y: number, z: number): number =>
  (Math.floor(x) + COORD_OFFSET) * NUMPOSKEY_X_STRIDE +
  (Math.floor(y) + COORD_OFFSET) * NUMPOSKEY_Y_STRIDE +
  (Math.floor(z) + COORD_OFFSET);

/**
 * Unpack a numPosKey back to coordinates.
 *
 * This did not exist, and its absence was a live crash: a caller still treated
 * the key as the old "x,y,z" STRING and called .split(',') on a number —
 * "TypeError: Z.split is not a function". Packing gained a numeric form and the
 * matching decode was never written, so every site that unpacks had to
 * improvise, and one of them improvised the old format.
 */
export function unpackPosKey(k: number, out?: { x: number; y: number; z: number }) {
  const o = out ?? { x: 0, y: 0, z: 0 };
  o.x = Math.floor(k / NUMPOSKEY_X_STRIDE) - COORD_OFFSET;
  const rem = k - (o.x + COORD_OFFSET) * NUMPOSKEY_X_STRIDE;
  o.y = Math.floor(rem / NUMPOSKEY_Y_STRIDE) - COORD_OFFSET;
  o.z = rem - (o.y + COORD_OFFSET) * NUMPOSKEY_Y_STRIDE - COORD_OFFSET;
  return o;
}
