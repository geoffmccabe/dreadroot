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
export function applySymmetry(
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
  
  // Use options or defaults (min 4 for decorations with tuning-fork patterns)
  const opts: Required<TreeGrowthOptions> = {
    lowBranchHeight: options?.lowBranchHeight ?? TREE_CONFIG.MIN_BRANCH_HEIGHT,
    spikeChance: options?.spikeChance ?? 0,
    spikeLength: Math.max(4, options?.spikeLength ?? 4),  // Min 4 for tuning-fork pattern
    nobChance: options?.nobChance ?? 0,
    nobSize: options?.nobSize ?? 1,
    crossChance: options?.crossChance ?? 0,
    crossLength: Math.max(4, options?.crossLength ?? 4),  // Min 4 for tuning-fork pattern
    shroomChance: options?.shroomChance ?? 0,
    shroomLength: Math.max(4, options?.shroomLength ?? 5),  // Min 4 for tuning-fork pattern
    shroomCapDiameter: options?.shroomCapDiameter ?? 3,
    shrineChance: options?.shrineChance ?? 0.0001,  // 0.01% default - very rare
    symmetry: symmetryMode,
  };
  
  // Helper to check/add position with symmetry - all symmetric blocks share same group
  const addBlock = (x: number, y: number, z: number, type: TreeBlockType, branchDepth: number = -1): boolean => {
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    let addedAny = false;
    const groupId = nextSymmetryGroup++;

    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({ x: pos.x, y, z: pos.z, type, growthOrder: 0, symmetryGroup: groupId, branchDepth });
        addedAny = true;
      }
    }
    return addedAny;
  };
  
  // 1. Generate trunk (always straight up) - trunk is always at center, each trunk block is its own group
  // Trunk blocks have branchDepth -1 (darkest)
  for (let h = 0; h < maxHeight; h++) {
    const key = `${baseX},${baseY + h},${baseZ}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      blocks.push({ x: baseX, y: baseY + h, z: baseZ, type: 'trunk', growthOrder: 0, symmetryGroup: nextSymmetryGroup++, branchDepth: -1 });
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
  const candidateBranchHeights = shuffledHeights.slice(0, branchCount * 2); // Get more candidates for filtering
  
  // 4. Get directions based on symmetry mode
  const availableDirections = getDirectionsForSymmetry(symmetryMode, rng);
  
  // Mutable counter for symmetry groups (passed by reference)
  const groupCounter = { value: nextSymmetryGroup };
  
  // 5. Track used heights per direction to enforce 2+ block gap
  // Key: "dx,dz" -> array of Y heights where branches exist
  const branchHeightsByDirection = new Map<string, number[]>();
  const MIN_BRANCH_GAP = 2; // Minimum vertical gap between branches on same side

  // Track decoration positions to enforce minimum spacing (3 empty blocks between)
  const decorPositions: Array<{ x: number; y: number; z: number }> = [];

  // 6. Generate branches at selected heights with gap enforcement
  let branchesCreated = 0;
  for (const branchY of candidateBranchHeights) {
    if (branchesCreated >= branchCount) break;
    
    const direction = seededChoice(availableDirections, rng);
    const dirKey = `${direction[0]},${direction[1]}`;
    
    // Check if this height conflicts with existing branches on same side
    const existingHeights = branchHeightsByDirection.get(dirKey) || [];
    const hasConflict = existingHeights.some(h => Math.abs(h - branchY) < MIN_BRANCH_GAP);
    
    if (hasConflict) {
      // Skip this branch - too close to another on the same side
      continue;
    }
    
    // Record this height for this direction
    if (!branchHeightsByDirection.has(dirKey)) {
      branchHeightsByDirection.set(dirKey, []);
    }
    branchHeightsByDirection.get(dirKey)!.push(branchY);
    
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
      groupCounter,  // mutable group counter
      decorPositions // shared decoration positions for spacing
    );
    
    branchesCreated++;
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

// Minimum gap between decorations (3 empty blocks = 4 total distance)
const MIN_DECORATION_GAP = 4;

/**
 * Check if a position is far enough from all existing decoration positions
 */
export function canPlaceDecoration(
  x: number,
  y: number,
  z: number,
  decorPositions: Array<{ x: number; y: number; z: number }>
): boolean {
  for (const pos of decorPositions) {
    const dist = Math.abs(x - pos.x) + Math.abs(y - pos.y) + Math.abs(z - pos.z);
    if (dist < MIN_DECORATION_GAP) {
      return false;
    }
  }
  return true;
}

/**
 * Recursively grow a branch in a direction
 * Branches can go horizontal or up, never down
 * Inline decoration generation - decorations use negative growthOrder as anchor links
 * treeBaseX/treeBaseZ are the trunk coordinates used for symmetry calculations
 * groupCounter is a mutable ref to track symmetry groups across recursive calls
 * decorPositions tracks all decoration positions to enforce minimum spacing
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
  groupCounter: { value: number } = { value: 0 },
  decorPositions: Array<{ x: number; y: number; z: number }> = []
): void {
  // Limit recursion depth
  if (depth > 3) return;
  
  // Helper to add block with symmetry - always relative to tree base
  // All symmetric blocks share the same symmetryGroup
  // branchDepth tracks how many forks from main trunk (passed as depth parameter)
  const addBlockWithSymmetry = (x: number, y: number, z: number, type: TreeBlockType): number => {
    const positions = applySymmetry(x, z, treeBaseX, treeBaseZ, symmetryMode);
    let firstAnchorIndex = -1;
    const groupId = groupCounter.value++;

    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        blocks.push({ x: pos.x, y, z: pos.z, type, growthOrder: 0, symmetryGroup: groupId, branchDepth: depth });
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
    
    // Add block(s) with symmetry - use 'branch' type for branch blocks (not 'trunk')
    const anchorIndex = addBlockWithSymmetry(x, y, z, 'branch');
    if (anchorIndex === -1) continue; // All positions occupied
    
    // Get the symmetry group of the anchor for decorations
    const anchorGroup = blocks[anchorIndex]?.symmetryGroup ?? 0;
    
    // ========== TRUNK JUNCTION RING (first step of branch) ==========
    // Add invisiblocks around the trunk at this height for walkability between branches
    if (i === 0) {
      addTrunkJunctionRing(blocks, occupied, treeBaseX, y, treeBaseZ, anchorIndex, anchorGroup, symmetryMode, depth);
    }
    
    // ========== INLINE DECORATION GENERATION ==========
    // Decorations are added at the primary position only
    // The symmetry is handled at the branch block level
    // Enforce minimum spacing between decorations (3 empty blocks)

    // Check if this position is far enough from existing decorations
    const canDecorate = canPlaceDecoration(x, y, z, decorPositions);

    if (canDecorate) {
      let decorationPlaced = false;

      // SPIKE: Vertical blocks going up
      if (!decorationPlaced && opts.spikeChance > 0 && rng() < opts.spikeChance) {
        addSpikeWithSymmetry(blocks, occupied, x, y, z, opts.spikeLength, anchorIndex, anchorGroup, rng, treeBaseX, treeBaseZ, symmetryMode, depth, direction);
        decorationPlaced = true;
      }

      // NOB: Cube of blocks adjacent to this point
      if (!decorationPlaced && opts.nobChance > 0 && rng() < opts.nobChance) {
        addNobWithSymmetry(blocks, occupied, x, y, z, opts.nobSize, anchorIndex, anchorGroup, rng, treeBaseX, treeBaseZ, symmetryMode, depth, direction);
        decorationPlaced = true;
      }

      // CROSS: Perpendicular + shape
      if (!decorationPlaced && opts.crossChance > 0 && rng() < opts.crossChance) {
        addCrossWithSymmetry(blocks, occupied, x, y, z, direction, opts.crossLength, anchorIndex, anchorGroup, treeBaseX, treeBaseZ, symmetryMode, depth);
        decorationPlaced = true;
      }

      // SHROOM: Stem + cap
      if (!decorationPlaced && opts.shroomChance > 0 && rng() < opts.shroomChance) {
        addShroomWithSymmetry(blocks, occupied, x, y, z, opts.shroomLength, opts.shroomCapDiameter, anchorIndex, anchorGroup, treeBaseX, treeBaseZ, symmetryMode, depth, direction);
        decorationPlaced = true;
      }

      // SHRINE: 5x5 hollow structure with tapered spire (very rare)
      if (!decorationPlaced && opts.shrineChance > 0 && rng() < opts.shrineChance) {
        addShrineWithSymmetry(blocks, occupied, x, y, z, anchorIndex, anchorGroup, treeBaseX, treeBaseZ, symmetryMode, depth, direction);
        decorationPlaced = true;
      }

      // Record decoration position if one was placed
      if (decorationPlaced) {
        decorPositions.push({ x, y, z });
      }
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
        groupCounter,  // Pass mutable counter through recursion
        decorPositions // Share decoration positions across branches
      );
    }
  }
}

// ========== DECORATION HELPER FUNCTIONS WITH SYMMETRY ==========

/**
 * Add a ring of branch blocks around the trunk at a specific height
 * This allows players to walk around the trunk to reach other branches
 */
export function addTrunkJunctionRing(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  trunkX: number,
  y: number,
  trunkZ: number,
  anchorIndex: number,
  anchorGroup: number,
  symmetryMode: SymmetryMode,
  branchDepth: number
): void {
  // 8 positions around the trunk (excluding trunk itself)
  const offsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],          [1, 0],
    [-1, 1],  [0, 1],  [1, 1]
  ];

  for (const [dx, dz] of offsets) {
    const x = trunkX + dx;
    const z = trunkZ + dz;
    const key = `${x},${y},${z}`;

    // Only add if not already occupied (no symmetry needed - trunk is always at center)
    if (!occupied.has(key)) {
      occupied.add(key);
      blocks.push({
        x,
        y,
        z,
        type: 'branch',  // Use branch blocks instead of invisiblocks
        growthOrder: -anchorIndex - 1,
        symmetryGroup: anchorGroup,
        branchDepth
      });
    }
  }
}

// Invisiblocks removed from tree generation - decorations now have built-in doorways

/**
 * Add a spike with 3-block high doorway above the branch
 * Shape: Vertical stack of 3 blocks on each side of branch, empty space above branch center,
 * then spike continues above the doorway
 * Minimum spike length is 4
 */
export function addSpikeWithSymmetry(
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
  symmetryMode: SymmetryMode,
  branchDepth: number = 0,
  branchDir: [number, number]
): void {
  // Enforce minimum spike length of 4
  const actualLength = Math.max(4, length);

  // Get perpendicular direction to the branch
  const perpX = branchDir[0] === 0 ? 1 : 0;
  const perpZ = branchDir[1] === 0 ? 1 : 0;

  // Helper to add a spike block
  const addSpikeBlock = (x: number, y: number, z: number) => {
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      blocks.push({
        x: pos.x,
        y,
        z: pos.z,
        type: 'spike',
        growthOrder: -anchorIndex - 1,
        symmetryGroup: anchorGroup,
        branchDepth
      });
    }
  };

  // SIDE STACKS: 3-block tall vertical stacks on each side of the branch
  // Creates walls that form a doorway/tunnel
  for (const perpSide of [1, -1]) {
    const sideX = startX + perpX * perpSide;
    const sideZ = startZ + perpZ * perpSide;

    // Stack of 3 blocks at Y+1, Y+2, Y+3
    for (let h = 1; h <= 3; h++) {
      addSpikeBlock(sideX, startY + h, sideZ);
    }
  }

  // SPIKE CONTINUATION: Single column above the branch center starting at Y+4
  // The doorway is at Y+1, Y+2, Y+3 (empty), spike starts at Y+4
  for (let i = 4; i <= actualLength; i++) {
    addSpikeBlock(startX, startY + i, startZ);
  }
}

/**
 * Add a nob (1x1 to 4x4 cube) in a random direction with symmetry
 * Rules:
 * - Small nobs (1x1 and 2x2) cannot spawn on top of branches, only sides or bottom
 * - Nobs on top of branches have a 3-block high tunnel through them for walkability
 */
export function addNobWithSymmetry(
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
  symmetryMode: SymmetryMode,
  branchDepth: number = 0,
  branchDir: [number, number]
): void {
  // Direction options: up, down, and 4 horizontal directions
  let directions: [number, number, number][] = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ];

  // Small nobs (1x1, 2x2) cannot spawn on top of branches
  if (size <= 2) {
    directions = directions.filter(d => d[1] !== 1); // Remove "up" direction
  }

  if (directions.length === 0) return; // Safety check

  const dir = directions[Math.floor(rng() * directions.length)];
  const isOnTop = dir[1] === 1; // Nob is above the branch

  const nobCenterX = centerX + dir[0] * (1 + Math.floor(size / 2));
  const nobCenterY = centerY + dir[1] * (1 + Math.floor(size / 2));
  const nobCenterZ = centerZ + dir[2] * (1 + Math.floor(size / 2));

  const halfSize = Math.floor(size / 2);
  const nobStartX = nobCenterX - halfSize;
  const nobStartY = nobCenterY - halfSize;
  const nobStartZ = nobCenterZ - halfSize;

  // Get perpendicular direction to the branch for tunnel orientation
  const perpX = branchDir[0] === 0 ? 1 : 0;
  const perpZ = branchDir[1] === 0 ? 1 : 0;

  for (let dx = 0; dx < size; dx++) {
    for (let dy = 0; dy < size; dy++) {
      for (let dz = 0; dz < size; dz++) {
        const x = nobStartX + dx;
        const y = nobStartY + dy;
        const z = nobStartZ + dz;

        // If nob is on top and size >= 3, create 3-block high tunnel through it
        // Tunnel runs perpendicular to branch direction, 1 block wide at center
        if (isOnTop && size >= 3) {
          // Calculate position relative to nob center
          const relX = x - nobCenterX;
          const relZ = z - nobCenterZ;
          const relY = y - nobStartY; // Height within the nob (0 to size-1)

          // Tunnel is at the center of the perpendicular axis
          // Check if this block is in the tunnel area
          const alongBranchOffset = branchDir[0] !== 0 ? relX : relZ;
          const perpOffset = perpX !== 0 ? relX : relZ;

          // Tunnel: center of perpendicular axis (offset 0), bottom 3 rows
          if (perpOffset === 0 && relY < 3) {
            continue; // Skip this block - it's part of the tunnel
          }
        }

        const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
        for (const pos of positions) {
          const key = `${pos.x},${y},${pos.z}`;
          if (occupied.has(key)) continue;
          occupied.add(key);
          blocks.push({ x: pos.x, y, z: pos.z, type: 'nob', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup, branchDepth });
        }
      }
    }
  }
}

/**
 * Add a cross made of 4 spikes at right angles around the branch
 * Each spike has 3-block high doorway with side stacks
 */
export function addCrossWithSymmetry(
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
  symmetryMode: SymmetryMode,
  branchDepth: number = 0
): void {
  // Enforce minimum length of 4 for the doorway pattern
  const actualLength = Math.max(4, length);

  // Helper to add a cross block
  const addCrossBlock = (x: number, y: number, z: number) => {
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      blocks.push({ x: pos.x, y, z: pos.z, type: 'cross', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup, branchDepth });
    }
  };

  // 4 directions around the branch: +X, -X, +Z, -Z
  const directions: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (const [dirX, dirZ] of directions) {
    // Get perpendicular direction for this spike arm
    const armPerpX = dirZ !== 0 ? 1 : 0;
    const armPerpZ = dirX !== 0 ? 1 : 0;

    // Arm base is 1 block out from center in the arm direction
    const armBaseX = centerX + dirX;
    const armBaseZ = centerZ + dirZ;

    // SIDE STACKS: 3-block tall vertical stacks on each side of the arm
    for (const perpSide of [1, -1]) {
      const sideX = armBaseX + armPerpX * perpSide;
      const sideZ = armBaseZ + armPerpZ * perpSide;

      // Stack of 3 blocks at Y+1, Y+2, Y+3
      for (let h = 1; h <= 3; h++) {
        addCrossBlock(sideX, centerY + h, sideZ);
      }
    }

    // SPIKE CONTINUATION: Single column at the arm position from Y+4 upward
    for (let i = 4; i <= actualLength; i++) {
      addCrossBlock(armBaseX, centerY + i, armBaseZ);
    }
  }
}

/**
 * Add a mushroom shape with symmetry
 * Shape: 3-block tall stacks on each side of branch (doorway), stem above, then cap
 */
export function addShroomWithSymmetry(
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
  symmetryMode: SymmetryMode,
  branchDepth: number = 0,
  branchDir: [number, number]
): void {
  // Minimum stem length to accommodate doorway (3 blocks) + at least 1 block of stem
  const actualStemLength = Math.max(4, stemLength);

  // Get perpendicular direction to the branch
  const perpX = branchDir[0] === 0 ? 1 : 0;
  const perpZ = branchDir[1] === 0 ? 1 : 0;

  // Helper to add a stem block
  const addStemBlock = (x: number, y: number, z: number) => {
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      blocks.push({ x: pos.x, y, z: pos.z, type: 'shroom_stem', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup, branchDepth });
    }
  };

  // SIDE STACKS: 3-block tall vertical stacks on each side of the branch
  // Creates walls that form a doorway/tunnel
  for (const perpSide of [1, -1]) {
    const sideX = shroomBaseX + perpX * perpSide;
    const sideZ = shroomBaseZ + perpZ * perpSide;

    // Stack of 3 blocks at Y+1, Y+2, Y+3
    for (let h = 1; h <= 3; h++) {
      addStemBlock(sideX, shroomBaseY + h, sideZ);
    }
  }

  // STEM CONTINUATION: Single column at center from Y+4 to stem top
  for (let i = 4; i <= actualStemLength; i++) {
    addStemBlock(shroomBaseX, shroomBaseY + i, shroomBaseZ);
  }

  // SHROOM CAP: Horizontal disc at top of stem
  const capY = shroomBaseY + actualStemLength + 1;
  const radius = Math.floor(capDiameter / 2);

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      // Skip corners for rounder shape (when diameter > 2)
      if (Math.abs(dx) === radius && Math.abs(dz) === radius && capDiameter > 2) continue;

      const positions = applySymmetry(shroomBaseX + dx, shroomBaseZ + dz, baseX, baseZ, symmetryMode);
      for (const pos of positions) {
        const key = `${pos.x},${capY},${pos.z}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        blocks.push({ x: pos.x, y: capY, z: pos.z, type: 'shroom_cap', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup, branchDepth });
      }
    }
  }
}

/**
 * addShrineWithSymmetry: Create a shrine decoration on a branch
 *
 * Shrines are 5x5 base structures with:
 * - 3x3 flat floor at branch level for walking
 * - Widened branch platform extending from doors for approach
 * - Hollow interior with two pass-through doors
 * - Tapered spire roof with gaps for interior glow
 *
 * Structure:
 * - Floor (y+0): 5x5 solid base with 3x3 walkable interior
 * - Walls (y+1 to y+5): 5x5 outer walls, 3x3 hollow interior, 5 layers
 *   - Two 2w x 3h doors aligned with branch direction
 * - Roof rings with gaps for glow:
 *   - y+6: 4x4 ring, y+7: skip, y+8: 3x3 ring, y+9: skip
 *   - y+10: 2x2 ring, y+11: skip, y+12: 2x2 ring
 * - Spire (y+13 to y+16): 1x1, 4 blocks
 */
export function addShrineWithSymmetry(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  shrineBaseX: number,
  shrineBaseY: number,
  shrineBaseZ: number,
  anchorIndex: number,
  anchorGroup: number,
  baseX: number,
  baseZ: number,
  symmetryMode: SymmetryMode,
  branchDepth: number = 0,
  branchDir: [number, number]
): void {
  // Helper to add a shrine block
  const addShrineBlock = (x: number, y: number, z: number) => {
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      blocks.push({ x: pos.x, y, z: pos.z, type: 'shrine', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup, branchDepth });
    }
  };

  // Helper to add a branch block (for platform extension)
  const addBranchBlock = (x: number, y: number, z: number) => {
    const positions = applySymmetry(x, z, baseX, baseZ, symmetryMode);
    for (const pos of positions) {
      const key = `${pos.x},${y},${pos.z}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      blocks.push({ x: pos.x, y, z: pos.z, type: 'branch', growthOrder: -anchorIndex - 1, symmetryGroup: anchorGroup, branchDepth });
    }
  };

  // Determine door direction based on branch direction
  // Doors face along the branch direction (so player can walk through along branch)
  const doorAlongX = branchDir[0] !== 0; // true if branch runs along X axis

  // FLOOR LAYER (y+0): Full 5x5 base - the floor is solid
  // This creates a 3x3 walkable interior since walls will be on the outer edge
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      addShrineBlock(shrineBaseX + dx, shrineBaseY, shrineBaseZ + dz);
    }
  }

  // BRANCH PLATFORM EXTENSION: Widen the approach from both doors
  // Add 3-wide walkway extending 3 blocks out from each door
  if (doorAlongX) {
    // Doors are at z=-2 and z=+2, extend along Z axis
    for (let ext = 3; ext <= 5; ext++) {
      // Negative Z door approach
      for (let dx = -1; dx <= 1; dx++) {
        addBranchBlock(shrineBaseX + dx, shrineBaseY, shrineBaseZ - ext);
      }
      // Positive Z door approach
      for (let dx = -1; dx <= 1; dx++) {
        addBranchBlock(shrineBaseX + dx, shrineBaseY, shrineBaseZ + ext);
      }
    }
  } else {
    // Doors are at x=-2 and x=+2, extend along X axis
    for (let ext = 3; ext <= 5; ext++) {
      // Negative X door approach
      for (let dz = -1; dz <= 1; dz++) {
        addBranchBlock(shrineBaseX - ext, shrineBaseY, shrineBaseZ + dz);
      }
      // Positive X door approach
      for (let dz = -1; dz <= 1; dz++) {
        addBranchBlock(shrineBaseX + ext, shrineBaseY, shrineBaseZ + dz);
      }
    }
  }

  // WALLS: 5x5 outer walls, 5 layers tall (y+1 to y+5)
  for (let layer = 1; layer <= 5; layer++) {
    const y = shrineBaseY + layer;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const x = shrineBaseX + dx;
        const z = shrineBaseZ + dz;

        // Check if this is an outer wall position (edge of 5x5)
        const isOuterEdge = Math.abs(dx) === 2 || Math.abs(dz) === 2;

        // Door positions: 2-wide gaps on opposite ends along branch direction
        // Doors are at y+1, y+2, y+3 (3 blocks tall from floor level)
        let isDoor = false;
        if (layer <= 3) {
          if (doorAlongX) {
            // Branch runs along X, doors are at z=-2 and z=+2 walls
            // Door spans dx=-1 to dx=0 (2 blocks wide, centered)
            isDoor = Math.abs(dz) === 2 && (dx === -1 || dx === 0);
          } else {
            // Branch runs along Z, doors are at x=-2 and x=+2 walls
            // Door spans dz=-1 to dz=0 (2 blocks wide, centered)
            isDoor = Math.abs(dx) === 2 && (dz === -1 || dz === 0);
          }
        }

        // Only place blocks on outer edge AND not in door opening
        if (isOuterEdge && !isDoor) {
          addShrineBlock(x, y, z);
        }
      }
    }
  }

  // ROOF LAYERS: Hollow rings with gaps for glow effect
  // y+6: 4x4 ring (hollow)
  const roofY6 = shrineBaseY + 6;
  for (let dx = -2; dx <= 1; dx++) {
    for (let dz = -2; dz <= 1; dz++) {
      // 4x4 ring: place only on edges
      const isEdge = dx === -2 || dx === 1 || dz === -2 || dz === 1;
      if (isEdge) {
        addShrineBlock(shrineBaseX + dx, roofY6, shrineBaseZ + dz);
      }
    }
  }

  // y+7: SKIP (gap for glow)

  // y+8: 3x3 ring (hollow)
  const roofY8 = shrineBaseY + 8;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const isEdge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
      if (isEdge) {
        addShrineBlock(shrineBaseX + dx, roofY8, shrineBaseZ + dz);
      }
    }
  }

  // y+9: SKIP (gap for glow)

  // y+10: 2x2 solid cap
  const roofY10 = shrineBaseY + 10;
  for (let dx = -1; dx <= 0; dx++) {
    for (let dz = -1; dz <= 0; dz++) {
      addShrineBlock(shrineBaseX + dx, roofY10, shrineBaseZ + dz);
    }
  }

  // y+11: SKIP (gap for glow)

  // y+12: 2x2 solid
  const roofY12 = shrineBaseY + 12;
  for (let dx = -1; dx <= 0; dx++) {
    for (let dz = -1; dz <= 0; dz++) {
      addShrineBlock(shrineBaseX + dx, roofY12, shrineBaseZ + dz);
    }
  }

  // SPIRE: 1x1 column from y+13 to y+16 (4 blocks)
  // Center the spire at -0.5, -0.5 offset (between the 4 2x2 blocks)
  for (let i = 13; i <= 16; i++) {
    addShrineBlock(shrineBaseX, shrineBaseY + i, shrineBaseZ);
  }
}

// ========== END DECORATION HELPERS ==========

/**
 * Assign growth order to blocks
 * Blocks in the same symmetryGroup get the same growthOrder so they appear together
 *
 * ARCHITECTURE FIX: Two-pass approach
 * Pass 1: Assign orders to regular (non-decoration) blocks
 * Pass 2: Decorations (negative growthOrder) inherit their anchor's final order
 */
function assignGrowthOrder(blocks: BlueprintBlock[], rng: () => number): void {
  
  // Build index map BEFORE any reordering - decorations reference anchor by original array index
  const originalIndexToBlock = new Map<number, BlueprintBlock>();
  for (let i = 0; i < blocks.length; i++) {
    originalIndexToBlock.set(i, blocks[i]);
  }
  
  // Separate decoration blocks from regular blocks
  const regularBlocks: BlueprintBlock[] = [];
  const decorationBlocks: BlueprintBlock[] = [];
  
  for (const block of blocks) {
    if (block.growthOrder < 0) {
      decorationBlocks.push(block);
    } else {
      regularBlocks.push(block);
    }
  }
  
  // Group regular blocks by symmetryGroup
  const groupToBlocks = new Map<number, BlueprintBlock[]>();
  
  for (const block of regularBlocks) {
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
  
  // PASS 1: Assign growth orders to regular blocks
  let order = 0;
  for (const [groupId, groupBlocks] of sortedGroups) {
    for (const block of groupBlocks) {
      block.growthOrder = order;
    }
    order++;
  }
  
  // PASS 2: Decorations inherit their anchor's order using the ORIGINAL array index
  for (const decoration of decorationBlocks) {
    const anchorIndex = -(decoration.growthOrder + 1);
    const anchorBlock = originalIndexToBlock.get(anchorIndex);
    
    if (anchorBlock && anchorBlock.growthOrder >= 0) {
      decoration.growthOrder = anchorBlock.growthOrder;
    } else {
      // Fallback: assign to order 0 if anchor not found
      decoration.growthOrder = 0;
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