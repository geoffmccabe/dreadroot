import { PlacedBlock } from '@/types/blocks';

/**
 * Occlusion culling for block rendering.
 *
 * Removes fully-surrounded (interior) blocks from the render list.
 * A block is "interior" if all 6 face-adjacent neighbors (±x, ±y, ±z) are occupied.
 * Interior blocks are invisible and waste GPU draw calls / vertex processing.
 *
 * This is especially impactful for large fungal trees (100K+ blocks) where
 * the vast majority of stem and cap blocks are completely hidden.
 *
 * Collision is unaffected — colliders are managed separately by useChunkLoader.
 */

// Neighbor offsets for 6 face-adjacent directions
const NEIGHBOR_OFFSETS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/**
 * Encode a block position into a compact string key for Set lookup.
 * Uses bitwise OR to ensure integer coordinates (blocks are always on-grid).
 */
function posKey(x: number, y: number, z: number): string {
  return `${x | 0},${y | 0},${z | 0}`;
}

/**
 * Filter out fully-surrounded blocks that can never be seen.
 *
 * @param blocks - Full array of blocks to cull
 * @returns New array containing only exposed (visible) blocks
 *
 * Performance: O(n) to build position set + O(6n) for neighbor checks = O(n).
 * For 100K blocks this runs in ~15-25ms (acceptable for a per-change operation).
 */
export function cullOccludedBlocks(blocks: PlacedBlock[]): PlacedBlock[] {
  if (blocks.length < 50) return blocks; // Not worth culling tiny sets

  // Build a Set of all occupied positions for O(1) neighbor lookups
  const occupied = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    occupied.add(posKey(b.position_x, b.position_y, b.position_z));
  }

  // Filter: keep only blocks that have at least one exposed face
  const exposed: PlacedBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const bx = b.position_x | 0;
    const by = b.position_y | 0;
    const bz = b.position_z | 0;

    let isInterior = true;
    for (let j = 0; j < 6; j++) {
      const [dx, dy, dz] = NEIGHBOR_OFFSETS[j];
      if (!occupied.has(posKey(bx + dx, by + dy, bz + dz))) {
        isInterior = false;
        break;
      }
    }

    if (!isInterior) {
      exposed.push(b);
    }
  }

  return exposed;
}
