// Tree Growth Algorithm
// Generates deterministic tree shapes from seed values

import { BlueprintBlock, TreeBlueprint, TreeGrowthOptions, TreeBlockType, SymmetryMode } from '../types';
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
 * Apply symmetry transformation to a position
 * Returns array of positions to place blocks at
 */
function applySymmetry(
  x: number,
  z: number,
  baseX: number,
  baseZ: number,
  mode: SymmetryMode
): Array<{ x: number; z: number }> {
  const relX = x - baseX;
  const relZ = z - baseZ;

  switch (mode) {
    case 'none':
      return [{ x, z }];

    case '2xs':
      // 2 branches on opposite sides, each mirrored = 4 blocks
      // Original, mirror Z, opposite X, opposite + mirror
      return [
        { x: baseX + relX, z: baseZ + relZ },  // original
        { x: baseX + relX, z: baseZ - relZ },  // mirror Z
        { x: baseX - relX, z: baseZ + relZ },  // opposite X
        { x: baseX - relX, z: baseZ - relZ },  // opposite + mirror
      ];

    case '4r':
      // 4-way rotational (90° increments) = 4 blocks
      return [
        { x: baseX + relX, z: baseZ + relZ },  // 0°
        { x: baseX - relZ, z: baseZ + relX },  // 90°
        { x: baseX - relX, z: baseZ - relZ },  // 180°
        { x: baseX + relZ, z: baseZ - relX },  // 270°
      ];

    case '4x2':
      // 4-way rotational + mirror each = 8 blocks
      return [
        // 0° + mirror
        { x: baseX + relX, z: baseZ + relZ },
        { x: baseX + relX, z: baseZ - relZ },
        // 90° + mirror
        { x: baseX - relZ, z: baseZ + relX },
        { x: baseX + relZ, z: baseZ + relX },
        // 180° + mirror
        { x: baseX - relX, z: baseZ - relZ },
        { x: baseX - relX, z: baseZ + relZ },
        // 270° + mirror
        { x: baseX + relZ, z: baseZ - relX },
        { x: baseX - relZ, z: baseZ - relX },
      ];

    default:
      return [{ x, z }];
  }
}

/**
 * Get branch directions based on symmetry mode
 * For symmetric modes, we only pick one primary direction
 * since symmetry will create the others
 */
function getDirectionsForSymmetry(
  mode: SymmetryMode,
  rng: () => number
): [number, number][] {
  switch (mode) {
    case 'none':
      // All 4 directions available
      return HORIZONTAL_DIRECTIONS;
    case '2xs':
    case '4r':
    case '4x2':
      // Only positive directions - symmetry handles the rest
      return [[1, 0], [0, 1]];
    default:
      return HORIZONTAL_DIRECTIONS;
  }
}

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

  // Get symmetry mode
  const symmetryMode: SymmetryMode = options?.symmetry ?? 'none';
  
  // Symmetry group counter - blocks in the same group grow together
  let nextSymmetryGroup = 0;
  
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
    symmetry: symmetryMode,
  };
  
  // Helper to check/add position with symmetry - all symmetric blocks share same group
  const addBlock = (x: number, y: number, z: number, type: TreeBlockType): boolean => {
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    let addedAny = false;
    const groupId = nextSymmetryGroup++;

    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({ x: pos.x, y, z: pos.z, type, growthOrder: 0, symmetryGroup: groupId });
        addedAny = true;
      }
    }
    return addedAny;
  };
  
  // 1. Generate trunk (always straight up) - trunk is always at center, each trunk block is its own group
  for (let h = 0; h < maxHeight; h++) {
    const key = `${baseX},${baseY + h},${baseZ}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      blocks.push({ x: baseX, y: baseY + h, z: baseZ, type: 'trunk', growthOrder: 0, symmetryGroup: nextSymmetryGroup++ });
    }
  }
  
  // 2. Calculate branch count based on height and branching factor
  // NO reduction for symmetric modes - symmetry creates visual density, not more "actions"
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
  
  // 4. Get directions based on symmetry mode
  const availableDirections = getDirectionsForSymmetry(symmetryMode, rng);
  
  // Mutable counter for symmetry groups (passed by reference)
  const groupCounter = { value: nextSymmetryGroup };
  
  // 5. Generate branches at selected heights
  for (const branchY of branchHeights) {
    const direction = seededChoice(availableDirections, rng);
    growBranch(
      blocks,
      occupied,
      baseX,        // branch starts at trunk
      branchY,
      baseZ,
      direction,
      maxBranchLength,
      branchingFactor,
      rng,
      opts,
      0,
      symmetryMode,
      baseX,        // tree base X for symmetry
      baseZ,        // tree base Z for symmetry
      groupCounter  // mutable group counter
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
 * treeBaseX/treeBaseZ are the trunk coordinates used for symmetry calculations
 * groupCounter is a mutable ref to track symmetry groups across recursive calls
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
  depth: number = 0,
  symmetryMode: SymmetryMode = 'none',
  treeBaseX: number = startX,
  treeBaseZ: number = startZ,
  groupCounter: { value: number } = { value: 0 }
): void {
  // Limit recursion depth
  if (depth > 3) return;
  
  // Helper to add block with symmetry - always relative to tree base
  // All symmetric blocks share the same symmetryGroup
  const addBlockWithSymmetry = (x: number, y: number, z: number, type: TreeBlockType): number => {
    const positions = applySymmetry(x, z, treeBaseX, treeBaseZ, symmetryMode);
    let firstAnchorIndex = -1;
    const groupId = groupCounter.value++;

    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({ x: pos.x, y, z: pos.z, type, growthOrder: 0, symmetryGroup: groupId });
        if (firstAnchorIndex === -1) {
          firstAnchorIndex = blocks.length - 1;
        }
      }
    }
    return firstAnchorIndex;
  };
  
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
    
    // Add block(s) with symmetry
    const anchorIndex = addBlockWithSymmetry(x, y, z, 'trunk');
    if (anchorIndex === -1) continue; // All positions occupied
    
    // Get the symmetry group of the anchor for decorations
    const anchorGroup = blocks[anchorIndex]?.symmetryGroup ?? 0;
    
    // ========== INLINE DECORATION GENERATION ==========
    // Decorations are added at the primary position only
    // The symmetry is handled at the branch block level
    
    // SPIKE: Vertical blocks going up
    if (opts.spikeChance > 0 && rng() < opts.spikeChance) {
      addSpikeWithSymmetry(blocks, occupied, x, y, z, opts.spikeLength, anchorIndex, anchorGroup, rng, treeBaseX, treeBaseZ, symmetryMode);
    }
    
    // NOB: Cube of blocks adjacent to this point
    if (opts.nobChance > 0 && rng() < opts.nobChance) {
      addNobWithSymmetry(blocks, occupied, x, y, z, opts.nobSize, anchorIndex, anchorGroup, rng, treeBaseX, treeBaseZ, symmetryMode);
    }
    
    // CROSS: Perpendicular + shape
    if (opts.crossChance > 0 && rng() < opts.crossChance) {
      addCrossWithSymmetry(blocks, occupied, x, y, z, direction, opts.crossLength, anchorIndex, anchorGroup, treeBaseX, treeBaseZ, symmetryMode);
    }
    
    // SHROOM: Stem + cap
    if (opts.shroomChance > 0 && rng() < opts.shroomChance) {
      addShroomWithSymmetry(blocks, occupied, x, y, z, opts.shroomLength, opts.shroomCapDiameter, anchorIndex, anchorGroup, treeBaseX, treeBaseZ, symmetryMode);
    }
    
    // ========== END DECORATIONS ==========
    
    // Chance to spawn sub-branch (decreases with depth)
    const subBranchChance = branchingFactor * 0.2 * (1 - depth * 0.3);
    if (rng() < subBranchChance && i > 0) {
      // Pick perpendicular direction - for symmetric modes, only positive dirs
      let perpDirections: [number, number][];
      if (symmetryMode === 'none') {
        perpDirections = direction[0] === 0
          ? [[1, 0], [-1, 0]]
          : [[0, 1], [0, -1]];
      } else {
        // For symmetric modes, only positive perpendicular
        perpDirections = direction[0] === 0
          ? [[1, 0]]
          : [[0, 1]];
      }
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
        depth + 1,
        symmetryMode,
        treeBaseX,    // Pass tree base through recursion
        treeBaseZ,
        groupCounter  // Pass mutable counter through recursion
      );
    }
  }
}

// ========== DECORATION HELPER FUNCTIONS WITH SYMMETRY ==========

/**
 * Add a vertical spike from a point with symmetry
 */
function addSpikeWithSymmetry(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  startX: number,
  startY: number,
  startZ: number,
  length: number,
  anchorIndex: number,
  anchorGroup: number,
  rng: () => number,
  baseX: number,
  baseZ: number,
  symmetryMode: SymmetryMode
): void {
  for (let i = 1; i <= length; i++) {
    const positions = applySymmetry(startX, startZ, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${startY + i},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({
          x: pos.x,
          y: startY + i,
          z: pos.z,
          type: 'spike',
          growthOrder: -anchorIndex - 1,
          symmetryGroup: anchorGroup
        });
      }
    }
  }
}

/**
 * Add a nob (1x1 to 4x4 cube) in a random direction with symmetry
 */
function addNobWithSymmetry(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  centerX: number,
  centerY: number,
  centerZ: number,
  size: number,
  anchorIndex: number,
  anchorGroup: number,
  rng: () => number,
  baseX: number,
  baseZ: number,
  symmetryMode: SymmetryMode
): void {
  const directions: [number, number, number][] = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ];
  const dir = directions[Math.floor(rng() * directions.length)];
  
  const nobCenterX = centerX + dir[0] * (1 + Math.floor(size / 2));
  const nobCenterY = centerY + dir[1] * (1 + Math.floor(size / 2));
  const nobCenterZ = centerZ + dir[2] * (1 + Math.floor(size / 2));
  
  const halfSize = Math.floor(size / 2);
  const nobStartX = nobCenterX - halfSize;
  const nobStartY = nobCenterY - halfSize;
  const nobStartZ = nobCenterZ - halfSize;
  
  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) {
      for (let dz = 0; dz < size; dz++) {
        const x = nobStartX + dx;
        const y = nobStartY + dy;
        const z = nobStartZ + dz;
        
        const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
        for (const pos of positions) {
          const key = `${pos.x},${y},${pos.z}`;
          if (!occupied.has(key)) {
            occupied.add(key);
            blocks.push({ x: pos.x, y, z: pos.z, type: 'nob', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup });
          }
        }
      }
    }
  }
}

/**
 * Add a + shaped cross perpendicular to branch direction with symmetry
 */
function addCrossWithSymmetry(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  centerX: number,
  centerY: number,
  centerZ: number,
  branchDir: [number, number],
  length: number,
  anchorIndex: number,
  anchorGroup: number,
  baseX: number,
  baseZ: number,
  symmetryMode: SymmetryMode
): void {
  const perpX = branchDir[0] === 0 ? 1 : 0;
  const perpZ = branchDir[1] === 0 ? 1 : 0;
  
  for (let i = -length; i <= length; i++) {
    if (i === 0) continue;
    const x = centerX + perpX * i;
    const z = centerZ + perpZ * i;
    
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${centerY},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({ x: pos.x, y: centerY, z: pos.z, type: 'cross', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup });
      }
    }
  }
  
  const centerPositions = applySymmetry(centerX, centerZ, baseX, baseZ, symmetryMode);
  for (let i = -length; i <= length; i++) {
    if (i === 0) continue;
    for (const pos of centerPositions) {
      const key = `${pos.x},${centerY + i},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({ x: pos.x, y: centerY + i, z: pos.z, type: 'cross', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup });
      }
    }
  }
}

/**
 * Add a mushroom shape with symmetry
 */
function addShroomWithSymmetry(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  shroomBaseX: number,
  shroomBaseY: number,
  shroomBaseZ: number,
  stemLength: number,
  capDiameter: number,
  anchorIndex: number,
  anchorGroup: number,
  baseX: number,
  baseZ: number,
  symmetryMode: SymmetryMode
): void {
  for (let i = 1; i <= stemLength; i++) {
    const positions = applySymmetry(shroomBaseX, shroomBaseZ, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${shroomBaseY + i},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({ x: pos.x, y: shroomBaseY + i, z: pos.z, type: 'shroom_stem', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup });
      }
    }
  }
  
  const capY = shroomBaseY + stemLength + 1;
  const radius = Math.floor(capDiameter / 2);
  
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (Math.abs(dx) === radius && Math.abs(dz) === radius && capDiameter > 2) continue;
      
      const positions = applySymmetry(shroomBaseX + dx, shroomBaseZ + dz, baseX, baseZ, symmetryMode);
      for (const pos of positions) {
        const key = `${pos.x},${capY},${pos.z}`;
        if (!occupied.has(key)) {
          occupied.add(key);
          blocks.push({ x: pos.x, y: capY, z: pos.z, type: 'shroom_cap', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup });
        }
      }
    }
  }
}

// ========== END DECORATION HELPERS ==========

/**
 * Assign growth order to blocks
 * Blocks in the same symmetryGroup get the same growthOrder so they appear together
 */
function assignGrowthOrder(blocks: BlueprintBlock[], rng: () => number): void {
  // Group blocks by symmetryGroup
  const groupToBlocks = new Map<number, BlueprintBlock[]>();
  
  for (const block of blocks) {
    const group = block.symmetryGroup ?? 0;
    if (!groupToBlocks.has(group)) {
      groupToBlocks.set(group, []);
    }
    groupToBlocks.get(group)!.push(block);
  }
  
  // Sort groups by the minimum Y of their blocks (trunk first, branches later)
  const sortedGroups = Array.from(groupToBlocks.entries())
    .sort((a, b) => {
      const minYA = Math.min(...a[1].map(b => b.y));
      const minYB = Math.min(...b[1].map(b => b.y));
      return minYA - minYB;
    });
  
  // Assign growth orders - all blocks in same group get same order
  let order = 0;
  for (const [groupId, groupBlocks] of sortedGroups) {
    // Check if these are decoration blocks (negative growthOrder means decoration)
    const isDecoration = groupBlocks.some(b => b.growthOrder < 0);
    
    if (isDecoration) {
      // Decorations inherit their anchor's order
      const anchorIndex = -(groupBlocks[0].growthOrder + 1);
      const anchorBlock = blocks[anchorIndex];
      const anchorOrder = anchorBlock?.growthOrder ?? order;
      for (const block of groupBlocks) {
        block.growthOrder = anchorOrder;
      }
    } else {
      // Regular blocks get sequential order
      for (const block of groupBlocks) {
        block.growthOrder = order;
      }
      order++;
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