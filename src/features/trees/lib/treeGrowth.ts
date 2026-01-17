// Tree Growth Algorithm
// Generates deterministic tree shapes from seed values

import { BlueprintBlock, TreeBlueprint } from '../types';
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
  seed: number
): TreeBlueprint {
  const rng = createSeededRandom(seed);
  const blocks: BlueprintBlock[] = [];
  const occupied = new Set<string>();
  
  // Calculate dimensions from tier and factors
  const maxHeight = tier * TREE_CONFIG.BLOCKS_PER_TIER_HEIGHT;
  const maxBranchLength = Math.max(1, Math.floor(maxHeight * widthFactor));
  
  // Helper to check/add position
  const addBlock = (x: number, y: number, z: number, type: 'trunk' | 'leaf'): boolean => {
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
  const minBranches = Math.max(1, Math.floor(maxHeight * 0.2));
  const maxBranches = Math.floor(maxHeight * branchingFactor * 0.6);
  const branchCount = seededInt(minBranches, maxBranches, rng);
  
  // 3. Pick branch heights (at least MIN_BRANCH_HEIGHT up, below top)
  const availableHeights: number[] = [];
  for (let h = TREE_CONFIG.MIN_BRANCH_HEIGHT; h < maxHeight - 1; h++) {
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
      rng
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
    blocks.push({ x, y, z, type: 'leaf', growthOrder: 0 });
    
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
        depth + 1
      );
    }
  }
}

/**
 * Assign growth order to blocks for interesting growth animation
 * Trunk grows first (bottom to top), then leaves spread out
 */
function assignGrowthOrder(blocks: BlueprintBlock[], rng: () => number): void {
  // Separate trunk and leaf blocks
  const trunk = blocks.filter(b => b.type === 'trunk');
  const leaves = blocks.filter(b => b.type === 'leaf');
  
  // Sort trunk by Y (bottom first)
  trunk.sort((a, b) => a.y - b.y);
  
  // Shuffle leaves for random growth
  const shuffledLeaves = seededShuffle(leaves, rng);
  
  // Assign orders: trunk first, then leaves
  let order = 0;
  for (const block of trunk) {
    block.growthOrder = order++;
  }
  for (const block of shuffledLeaves) {
    block.growthOrder = order++;
  }
}

/**
 * Get the block that should grow next based on current progress
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
  const totalMs = intervalMs * blueprint.blocks.length;
  return TREE_CONFIG.TESTING_MODE 
    ? totalMs / TREE_CONFIG.SPEED_MULTIPLIER 
    : totalMs;
}
