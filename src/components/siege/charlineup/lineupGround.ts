/**
 * Where the lineup's feet go.
 *
 * The lineup was written for Siege Worlds, where `sampleHeight` reads a
 * heightfield and always has an answer. DreadRoot has no heightfield — it is a
 * voxel world — so that sampler returns null and the old code fell back to the
 * CAMERA's Y. Standing on the ground that is only eye-height wrong; flying in
 * god mode it put the whole row up in the sky, which is exactly what happened.
 *
 * So: ask the heightfield first (Siege), and when it has nothing, walk DOWN the
 * voxel column from the start height until we hit a solid cube and stand on top
 * of it. That reads the same collision grid the player's own movement uses, so
 * the characters stand on precisely the surface the player would.
 */
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { sampleHeight } from '../terrainHeight';

/** How far down to look before giving up. Deeper than any tree/fortress drop. */
const MAX_SCAN = 256;

/** Which source answered the last call — read by scripts/check-lineup.mjs so a
 *  wrong height can be traced to the sampler that produced it. */
export let lastGroundSource: 'voxel' | 'player-column' | 'heightfield' | 'world-floor' = 'world-floor';

/** DreadRoot's hard floor — the same constant the shpider AI and death fragments
 *  use. Everything in the world sits on or above it. */
const WORLD_FLOOR_Y = 0;

/** Number of things in the block collision grid — so a check can tell "the scan
 *  is broken" apart from "there are genuinely no blocks here". */
export const gridSize = (): number => worldCollisionGrid.size;

/**
 * Top of the block column at (x, z), searching down from `startY`.
 * Null when the column is empty all the way down.
 */
export function voxelGroundY(x: number, z: number, startY: number): number | null {
  const bx = Math.floor(x), bz = Math.floor(z);
  const top = Math.ceil(startY);
  for (let y = top; y >= top - MAX_SCAN; y--) {
    if (worldCollisionGrid.hasVoxel(bx, y, bz)) return y + 1;
  }
  return null;
}

/**
 * Where the row's feet go at (x, z), searching down from `startY`.
 *
 * VOXELS FIRST. DreadRoot has a heightfield sampler registered, but it answers
 * with a flat plane near y=0 — a false floor nowhere near the terrain once you
 * are on a hill or up a tree (measured: it said 0.1 with the player at y=2).
 *
 * `playerXZ` is the escape hatch that actually fixes the reported bug: in god
 * mode the camera can be a hundred metres up over an unloaded column, and
 * anything camera-relative puts the whole lineup in the sky. The player is
 * standing on something, so that column is a far better guess than the camera.
 */
export function lineupGroundY(
  x: number, z: number, startY: number, playerXZ?: { x: number; z: number },
): number {
  const v = voxelGroundY(x, z, startY);
  if (v !== null) { lastGroundSource = 'voxel'; return v; }
  if (playerXZ) {
    const p = voxelGroundY(playerXZ.x, playerXZ.z, startY);
    if (p !== null) { lastGroundSource = 'player-column'; return p; }
  }
  const h = sampleHeight(x, z);
  if (h !== null && h !== undefined) { lastGroundSource = 'heightfield'; return h; }
  // NEVER camera-relative. The old fallback was the camera's own height, which is
  // why "&&&" in god mode put the whole lineup a hundred metres up. DreadRoot has
  // a hard floor under everything, so falling back to it is always on the ground
  // and never in the sky.
  lastGroundSource = 'world-floor';
  return WORLD_FLOOR_Y;
}

// Dev probe for scripts/check-lineup.mjs: "what does the block grid actually say
// under this column?". The lineup's feet come straight off this, and a wrong
// height is otherwise indistinguishable from a wrong sampler.
if (typeof window !== 'undefined') {
  (window as unknown as { __lineupProbe?: (x: number, z: number, top: number) => unknown }).__lineupProbe =
    (x, z, top) => {
      const bx = Math.floor(x), bz = Math.floor(z);
      const hits: number[] = [];
      for (let y = Math.ceil(top); y >= Math.ceil(top) - 40; y--) {
        if (worldCollisionGrid.hasVoxel(bx, y, bz)) hits.push(y);
      }
      // Both storage paths at once: getNearbyFiltered collects Box3 colliders AND voxels.
      const n = worldCollisionGrid.getNearbyFiltered(x, z, 2, -60, 60);
      const boxes: string[] = [];
      for (let i = 0; i < Math.min(n, 6); i++) {
        const b = worldCollisionGrid.nearbyResult[i];
        boxes.push(`${b.min.x},${b.min.y},${b.min.z}..${b.max.x},${b.max.y},${b.max.z}`);
      }
      return { bx, bz, hits: hits.slice(0, 8), near: n, boxes, gridSize: worldCollisionGrid.size };
    };
}
