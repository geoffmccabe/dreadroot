// World positions of every planted tree's SEED block (the block at the tree
// base). PlacedBlocks exempts these from occlusion culling so the seed always
// renders. Normal-tree seeds are 'fruit' blocks (already exempt by type), but
// fungal seeds are 'fungal_stem' blocks at the base — culling could hide them
// (only the floating text label would show). Keyed by a simple position string
// (self-contained — no dependency on spatialHashGrid's numeric packer).
//
// Published from FortressScene (which has plantedTrees) via setSeedPositions;
// `version` bumps on every update so the per-chunk occlusion cache re-runs once
// seeds are known.

export const seedPositions = new Set<string>();
export const seedState = { version: 0 };

export function seedKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function setSeedPositions(
  trees: ReadonlyArray<{ base_x: number; base_y: number; base_z: number }>,
): void {
  seedPositions.clear();
  for (const t of trees) seedPositions.add(seedKey(t.base_x, t.base_y, t.base_z));
  seedState.version++;
}
