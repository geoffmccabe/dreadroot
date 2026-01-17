// Tree Growth Algorithm
// Generates deterministic tree shapes from seed values

import { BlueprintBlock, TreeBlueprint, TreeGrowthOptions, TreeBlockType } from '../types';
import { createSeededRandom, seededShuffle, seededChoice, seededInt } from './seededRandom';
import { TREE_CONFIG } from '../constants';

// Direction vectors for branch growth (never down)
const HORIZONTAL_DIRECTIONS: [number, number][] = [
  [1, 0],   // +X
  [-1, 0],  // -X
  [0, 1],   // +Z
  [0, -1],  // -Z
];

/**
 * Generate a complete tree blueprint from parameters
 * The blueprint is deterministic - same inputs always produce same tree
 */
export function generateTreeBlueprint(
  baseX: number,
  baseY: number,
  baseZ: number,
  tier: number,
  widthFactor: number,
  branchingFactor: number,
  seed: number,
  options?: TreeGrowthOptions
): TreeBlueprint {
  const rng = createSeededRandom(seed);
  const blocks: BlueprintBlock[] = [];
  const occupied = new Set<string>();
  
  // Calculate dimensions from tier and factors
  const maxHeight = tier * TREE_CONFIG.BLOCKS_PER_TIER_HEIGHT;
  const maxBranchLength = Math.max(1, Math.floor(maxHeight * widthFactor));
  
  // Use options or defaults
  const opts: Required<TreeGrowthOptions> = {
    lowBranchHeight: options?.lowBranchHeight ?? TREE_CONFIG.MIN_BRANCH_HEIGHT,
    spikeChance: options?.spikeChance ?? 0,
    spikeLength: options?.spikeLength ?? 3,
    nobChance: options?.nobChance ?? 0,
    nobSize: options?.nobSize ?? 1,
    crossChance: options?.crossChance ?? 0,
    crossLength: options?.crossLength ?? 3,
    shroomChance: options?.shroomChance ?? 0,
    shroomLength: options?.shroomLength ?? 5,
    shroomCapDiameter: options?.shroomCapDiameter ?? 3,
  };
  
  // Helper to check/add position
  const addBlock = (x: number, y: number, z: number, type: TreeBlockType): boolean => {
    const key = `${x},${y},${z}`;
    if (occupied.has(key)) return false;
    occupied.add(key);
    blocks.push({ x, y, z, type, growthOrder: 0 });
    return true;
  };
  
  // 1. Generate trunk (always straight up)
  for (let h = 0; h < maxHeight; h++) {
    addBlock(baseX, baseY + h, baseZ, 'trunk');
  }
  
  // 2. Calculate branch count based on height and branching factor
  // TRIPLED for more dramatic trees
  const minBranches = Math.max(1, Math.floor(maxHeight * 0.2));
  const maxBranches = Math.floor(maxHeight * branchingFactor * 0.6 * 3);
  const branchCount = seededInt(minBranches, maxBranches, rng);
  
  // 3. Pick branch heights (at least lowBranchHeight up, below top)
  const availableHeights: number[] = [];
  for (let h = opts.lowBranchHeight; h < maxHeight - 1; h++) {
    availableHeights.push(baseY + h);
  }
  
  const shuffledHeights = seededShuffle(availableHeights, rng);
  const branchHeights = shuffledHeights.slice(0, branchCount);
  
  // 4. Generate branches at selected heights
  for (const branchY of branchHeights) {
    const direction = seededChoice(HORIZONTAL_DIRECTIONS, rng);
    growBranch(
      blocks,
      occupied,
      baseX,
      branchY,
      baseZ,
      direction,
      maxBranchLength,
      branchingFactor,
      rng,
      opts,
      0
    );
  }
  
  // 5. Assign growth order (randomized for interesting growth pattern)
  assignGrowthOrder(blocks, rng);
  
  // Calculate max width for metadata
  let maxWidth = 0;
  for (const block of blocks) {
    const dx = Math.abs(block.x - baseX);
    const dz = Math.abs(block.z - baseZ);
    maxWidth = Math.max(maxWidth, dx, dz);
  }
  
  return {
    blocks,
    maxHeight,
    maxWidth,
  };
}

/**
 * Recursively grow a branch in a direction
 * Branches can go horizontal or up, never down
 * Inline decoration generation - decorations use negative growthOrder as anchor links
 */
function growBranch(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  startX: number,
  startY: number,
  startZ: number,
  direction: [number, number],
  maxLength: number,
  branchingFactor: number,
  rng: () => number,
  opts: Required<TreeGrowthOptions>,
  depth: number = 0
): void {
  // Limit recursion depth
  if (depth > 3) return;
  
  let x = startX;
  let y = startY;
  let z = startZ;
  
  // Random length for this branch
  const length = seededInt(1, maxLength, rng);
  
  for (let i = 0; i < length; i++) {
    // Move in direction
    x += direction[0];
    z += direction[1];
    
    // 30% chance to grow UP (never down)
    if (rng() < 0.3) {
      y += 1;
    }
    
    // Try to add block
    const key = `${x},${y},${z}`;
    if (occupied.has(key)) continue;
    
    occupied.add(key);
    // Branches are trunk blocks
    blocks.push({ x, y, z, type: 'trunk', growthOrder: 0 });
    
    // Store anchor index for decorations (they'll inherit this block's growth order)
    const anchorIndex = blocks.length - 1;
    
    // ========== INLINE DECORATION GENERATION ==========
    // Each decoration roll happens here with its own % chance
    // Decorations get negative growthOrder linking to their anchor
    
    // SPIKE: Vertical blocks going up
    if (opts.spikeChance > 0 && rng() < opts.spikeChance) {
      addSpike(blocks, occupied, x, y, z, opts.spikeLength, anchorIndex, rng);
    }
    
    // NOB: Cube of blocks adjacent to this point
    if (opts.nobChance > 0 && rng() < opts.nobChance) {
      addNob(blocks, occupied, x, y, z, opts.nobSize, anchorIndex, rng);
    }
    
    // CROSS: Perpendicular + shape
    if (opts.crossChance > 0 && rng() < opts.crossChance) {
      addCross(blocks, occupied, x, y, z, direction, opts.crossLength, anchorIndex);
    }
    
    // SHROOM: Stem + cap
    if (opts.shroomChance > 0 && rng() < opts.shroomChance) {
      addShroom(blocks, occupied, x, y, z, opts.shroomLength, opts.shroomCapDiameter, anchorIndex);
    }
    
    // ========== END DECORATIONS ==========
    
    // Chance to spawn sub-branch (decreases with depth)
    const subBranchChance = branchingFactor * 0.2 * (1 - depth * 0.3);
    if (rng() < subBranchChance && i > 0) {
      // Pick perpendicular direction
      const perpDirections = direction[0] === 0
        ? [[1, 0], [-1, 0]] as [number, number][]
        : [[0, 1], [0, -1]] as [number, number][];
      const perpDir = seededChoice(perpDirections, rng);
      
      growBranch(
        blocks,
        occupied,
        x, y, z,
        perpDir,
        Math.floor(maxLength * 0.4),
        branchingFactor * 0.5,
        rng,
        opts,
        depth + 1
      );
    }
  }
}

// ========== DECORATION HELPER FUNCTIONS ==========

/**
 * Add a vertical spike from a point
 */
function addSpike(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  startX: number,
  startY: number,
  startZ: number,
  length: number,
  anchorIndex: number,
  rng: () => number
): void {
  for (let i = 1; i <= length; i++) {
    const key = `${startX},${startY + i},${startZ}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      // Negative growthOrder = linked to anchor block
      blocks.push({
        x: startX,
        y: startY + i,
        z: startZ,
        type: 'spike',
        growthOrder: -anchorIndex - 1
      });
    }
  }
}

/**
 * Add a nob (1x1 to 4x4 cube) in a random position adjacent to point
 */
function addNob(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  centerX: number,
  centerY: number,
  centerZ: number,
  size: number,
  anchorIndex: number,
  rng: () => number
): void {
  // Pick random offset direction (up, down, left, right, front, back)
  const offsets: [number, number, number][] = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]
  ];
  const offsetIdx = Math.floor(rng() * offsets.length);
  const offset = offsets[offsetIdx];
  
  const baseX = centerX + offset[0] * Math.ceil(size / 2);
  const baseY = centerY + offset[1] * Math.ceil(size / 2);
  const baseZ = centerZ + offset[2] * Math.ceil(size / 2);
  
  // Generate cube of blocks
  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) {
      for (let dz = 0; dz < size; dz++) {
        const x = baseX + dx;
        const y = baseY + dy;
        const z = baseZ + dz;
        const key = `${x},${y},${z}`;
        if (!occupied.has(key)) {
          occupied.add(key);
          blocks.push({
            x, y, z,
            type: 'nob',
            growthOrder: -anchorIndex - 1
          });
        }
      }
    }
  }
}

/**
 * Add a + shaped cross perpendicular to branch direction
 */
function addCross(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  centerX: number,
  centerY: number,
  centerZ: number,
  branchDir: [number, number],
  length: number,
  anchorIndex: number
): void {
  // Cross is perpendicular to branch direction + vertical
  const perpX = branchDir[0] === 0 ? 1 : 0;
  const perpZ = branchDir[1] === 0 ? 1 : 0;
  
  // Horizontal arm (perpendicular to branch)
  for (let i = -length; i <= length; i++) {
    if (i === 0) continue;
    const x = centerX + perpX * i;
    const z = centerZ + perpZ * i;
    const key = `${x},${centerY},${z}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      blocks.push({
        x, y: centerY, z,
        type: 'cross',
        growthOrder: -anchorIndex - 1
      });
    }
  }
  
  // Vertical arm
  for (let i = -length; i <= length; i++) {
    if (i === 0) continue;
    const key = `${centerX},${centerY + i},${centerZ}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      blocks.push({
        x: centerX, y: centerY + i, z: centerZ,
        type: 'cross',
        growthOrder: -anchorIndex - 1
      });
    }
  }
}

/**
 * Add a mushroom shape: stem + rounded cap
 */
function addShroom(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  baseX: number,
  baseY: number,
  baseZ: number,
  stemLength: number,
  capDiameter: number,
  anchorIndex: number
): void {
  // Stem (spike going up)
  for (let i = 1; i <= stemLength; i++) {
    const key = `${baseX},${baseY + i},${baseZ}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      blocks.push({
        x: baseX, y: baseY + i, z: baseZ,
        type: 'shroom_stem',
        growthOrder: -anchorIndex - 1
      });
    }
  }
  
  // Cap (rounded square at top)
  const capY = baseY + stemLength + 1;
  const radius = Math.floor(capDiameter / 2);
  
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      // Skip corners to make it rounded
      const isCorner = Math.abs(dx) === radius && Math.abs(dz) === radius;
      if (isCorner && capDiameter > 2) continue;
      
      const x = baseX + dx;
      const z = baseZ + dz;
      const key = `${x},${capY},${z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({
          x, y: capY, z,
          type: 'shroom_cap',
          growthOrder: -anchorIndex - 1
        });
      }
    }
  }
}

// ========== END DECORATION HELPERS ==========

/**
 * Assign growth order to blocks for interesting growth animation
 * Trunk grows first (bottom to top), then branches spread out
 * Decorations inherit the growthOrder of their anchor block
 */
function assignGrowthOrder(blocks: BlueprintBlock[], rng: () => number): void {
  // First pass: assign orders to trunk blocks only (non-decoration blocks)
  const trunkBlocks = blocks.filter(b => b.type === 'trunk');
  
  // Sort trunk by Y (bottom first)
  trunkBlocks.sort((a, b) => a.y - b.y);
  
  // Build index map for trunk blocks
  const blockIndexToOrder = new Map<number, number>();
  
  let order = 0;
  for (const block of trunkBlocks) {
    const idx = blocks.indexOf(block);
    block.growthOrder = order;
    blockIndexToOrder.set(idx, order);
    order++;
  }
  
  // Second pass: decorations inherit anchor's order
  for (const block of blocks) {
    if (block.growthOrder < 0) {
      // Decode anchor index from negative growthOrder
      const anchorIndex = -(block.growthOrder + 1);
      const anchorOrder = blockIndexToOrder.get(anchorIndex);
      block.growthOrder = anchorOrder ?? 0;
    }
  }
}

/**
 * Get all blocks that should grow at a specific order
 * Returns multiple blocks when decorations share an order with their anchor
 */
export function getBlocksAtOrder(
  blueprint: TreeBlueprint,
  order: number
): BlueprintBlock[] {
  return blueprint.blocks.filter(b => b.growthOrder === order);
}

/**
 * Get the maximum growth order in the blueprint
 */
export function getMaxGrowthOrder(blueprint: TreeBlueprint): number {
  return Math.max(...blueprint.blocks.map(b => b.growthOrder));
}

/**
 * Get the block that should grow next based on current progress
 * @deprecated Use getBlocksAtOrder for batch placement
 */
export function getNextGrowthBlock(
  blueprint: TreeBlueprint,
  currentBlockCount: number
): BlueprintBlock | null {
  return blueprint.blocks.find(b => b.growthOrder === currentBlockCount) || null;
}

/**
 * Calculate estimated growth time for a tree
 */
export function estimateGrowthTime(
  blueprint: TreeBlueprint,
  growthFactor: number
): number {
  const intervalMs = (TREE_CONFIG.BASE_GROWTH_INTERVAL / growthFactor);
  // Use max order + 1 as step count (not total blocks)
  const maxOrder = getMaxGrowthOrder(blueprint);
  const totalMs = intervalMs * (maxOrder + 1);
  return TREE_CONFIG.TESTING_MODE 
    ? totalMs / TREE_CONFIG.SPEED_MULTIPLIER 
    : totalMs;
}