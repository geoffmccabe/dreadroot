/**
 * Wide Tree Branch Generator
 *
 * Generates thick tapering branches with decorations for wide trees.
 * Branch start radius depends on tier (2-5 blocks), tapers to 1.
 * Decorations (spike, nob, cross, shroom) only on radius-1 branch tips.
 * Glow bark applied to ~30% of branch underside blocks.
 */

import { BlueprintBlock, TreeBlockType, SymmetryMode, TreeGrowthOptions, SeedDefinition } from '../types';
import { createSeededRandom, seededInt, seededChoice, seededShuffle } from './seededRandom';
import { getDiskBlocks } from './cylinderMath';
import {
  applySymmetry,
  canPlaceDecoration,
  addSpikeWithSymmetry,
  addNobWithSymmetry,
  addCrossWithSymmetry,
  addShroomWithSymmetry,
  addShrineWithSymmetry,
} from './treeGrowth';
import {
  WIDE_BRANCH_MIN_HEIGHT_RATIO,
  WIDE_BRANCH_MAX_HEIGHT_RATIO,
  WIDE_BRANCH_MIN_GAP,
  WIDE_GLOW_BARK_COVERAGE,
  WIDE_BLOCK_TYPES,
  getWideBranchStartRadius,
} from './wideTreeConstants';
import { WideShapeConfig, getTrunkCenterOffset } from './wideTreeTrunk';

const HORIZONTAL_DIRECTIONS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

interface WideBranchParams {
  branchingFactor: number;
  widthFactor: number;
  tier: number;
  symmetryMode: SymmetryMode;
  opts: Required<TreeGrowthOptions>;
}

/**
 * Generate all branches for a wide tree.
 * Returns branch blocks with growth orders starting at 2000+.
 */
export function generateWideBranches(
  centerX: number,
  baseY: number,
  centerZ: number,
  height: number,
  baseRadius: number,
  growthSeed: number,
  seedDefinition: SeedDefinition | undefined,
  shapeConfig: WideShapeConfig,
  params: WideBranchParams,
  glowRng: () => number,
  glowColor: string | null,
  startingGrowthOrder: number = 2000
): BlueprintBlock[] {
  const rng = createSeededRandom(growthSeed + 55555);
  const blocks: BlueprintBlock[] = [];
  const occupied = new Set<string>();

  const { branchingFactor, widthFactor, tier, symmetryMode, opts } = params;
  const branchStartRadius = getWideBranchStartRadius(tier);

  // Calculate branch count
  const minBranches = Math.max(2, Math.floor(height * 0.15));
  const maxBranches = Math.floor(height * branchingFactor * 0.5 * 2);
  const branchCount = seededInt(minBranches, maxBranches, rng);

  // Available heights for branches (25%-85% of tree height)
  const minH = Math.floor(height * WIDE_BRANCH_MIN_HEIGHT_RATIO);
  const maxH = Math.floor(height * WIDE_BRANCH_MAX_HEIGHT_RATIO);
  const availableHeights: number[] = [];
  for (let h = minH; h <= maxH; h++) {
    availableHeights.push(baseY + h);
  }
  const shuffledHeights = seededShuffle(availableHeights, rng);

  // Get directions based on symmetry
  const availableDirections: [number, number][] = symmetryMode === 'none'
    ? HORIZONTAL_DIRECTIONS
    : [[1, 0], [0, 1]];

  // Track used heights per direction for gap enforcement
  const heightsByDir = new Map<string, number[]>();
  const decorPositions: Array<{ x: number; y: number; z: number }> = [];
  let branchGrowthOrder = startingGrowthOrder;
  let groupCounter = 10000; // High to avoid collision with trunk groups

  let branchesCreated = 0;
  for (const branchY of shuffledHeights) {
    if (branchesCreated >= branchCount) break;

    const direction = seededChoice(availableDirections, rng);
    const dirKey = `${direction[0]},${direction[1]}`;

    const existingHeights = heightsByDir.get(dirKey) || [];
    if (existingHeights.some(h => Math.abs(h - branchY) < WIDE_BRANCH_MIN_GAP)) continue;

    if (!heightsByDir.has(dirKey)) heightsByDir.set(dirKey, []);
    heightsByDir.get(dirKey)!.push(branchY);

    // Get trunk center at this height for branch origin
    const { offsetX, offsetZ } = getTrunkCenterOffset(branchY, baseY, height, shapeConfig);
    const trunkCX = centerX + offsetX;
    const trunkCZ = centerZ + offsetZ;

    // Trunk radius at this height (for branch starting position)
    const trunkR = Math.max(1, Math.round(baseRadius - (baseRadius - 1) * ((branchY - baseY) / (height - 1))));

    // Cap branch radius to trunk radius - 1 (branch diameter must be < trunk diameter at this height)
    const effectiveBranchRadius = Math.max(1, Math.min(branchStartRadius, trunkR - 1));

    // Branch starts just outside trunk wall
    const startX = trunkCX + direction[0] * (trunkR + 1);
    const startZ = trunkCZ + direction[1] * (trunkR + 1);

    const branchBlocks = growWideBranch(
      startX, branchY, startZ,
      direction, effectiveBranchRadius, widthFactor,
      rng, opts, symmetryMode,
      centerX, centerZ, // tree base for symmetry
      occupied, blocks, decorPositions,
      branchGrowthOrder, groupCounter
    );

    branchGrowthOrder += branchBlocks.addedCount + 100; // Gap between branches
    groupCounter += branchBlocks.groupsUsed + 10;
    branchesCreated++;
  }

  // Glow bark pass: convert ~30% of branch underside blocks
  if (glowColor) {
    for (const block of blocks) {
      // Only apply to branch blocks (not decorations)
      if (block.type === 'branch' && glowRng() < WIDE_GLOW_BARK_COVERAGE) {
        block.type = WIDE_BLOCK_TYPES.GLOW_BARK as TreeBlockType;
      }
    }
  }

  return blocks;
}

/**
 * Grow a single thick tapering branch.
 * Branch starts at branchStartRadius and tapers to 1.
 * At radius 1, decorations can be placed.
 */
function growWideBranch(
  startX: number,
  startY: number,
  startZ: number,
  direction: [number, number],
  startRadius: number,
  widthFactor: number,
  rng: () => number,
  opts: Required<TreeGrowthOptions>,
  symmetryMode: SymmetryMode,
  treeBaseX: number,
  treeBaseZ: number,
  occupied: Set<string>,
  allBlocks: BlueprintBlock[],
  decorPositions: Array<{ x: number; y: number; z: number }>,
  baseGrowthOrder: number,
  baseGroupId: number
): { addedCount: number; groupsUsed: number } {
  let addedCount = 0;
  let groupsUsed = 0;

  // Branch length scales with start radius and width_factor setting (0-1)
  // widthFactor acts as length multiplier: 0.5x at 0, 1x at 0.5, 2x at 1.0
  const lengthMult = 0.5 + widthFactor * 1.5;
  const minLength = Math.max(6, Math.round(startRadius * 3 * lengthMult));
  const maxLength = Math.max(minLength + 4, Math.round((startRadius * 6 + 6) * lengthMult));
  const length = seededInt(minLength, maxLength, rng);

  let x = startX;
  let y = startY;
  let z = startZ;

  for (let i = 0; i < length; i++) {
    // Taper radius linearly from startRadius to 1
    const t = i / Math.max(1, length - 1);
    const radius = Math.max(1, Math.round(startRadius * (1 - t) + 1 * t));

    // 30% chance to go up
    if (rng() < 0.3) {
      y += 1;
    }

    const groupId = baseGroupId + groupsUsed;
    groupsUsed++;

    if (radius >= 2) {
      // Thick branch: filled disk perpendicular to direction
      const diskBlocks = getDiskBlocks(x, y, z, radius);
      for (const pos of diskBlocks) {
        const positions = applySymmetry(pos.x, pos.z, treeBaseX, treeBaseZ, symmetryMode);
        for (const sp of positions) {
          const key = `${sp.x},${y},${sp.z}`;
          if (!occupied.has(key)) {
            occupied.add(key);
            allBlocks.push({
              x: sp.x,
              y,
              z: sp.z,
              type: 'branch' as TreeBlockType,
              growthOrder: baseGrowthOrder + addedCount,
              symmetryGroup: groupId,
              branchDepth: 0,
            });
            addedCount++;
          }
        }
      }
    } else {
      // Single-block branch with symmetry
      const positions = applySymmetry(x, z, treeBaseX, treeBaseZ, symmetryMode);
      let anchorIndex = -1;
      for (const pos of positions) {
        const key = `${pos.x},${y},${pos.z}`;
        if (!occupied.has(key)) {
          occupied.add(key);
          allBlocks.push({
            x: pos.x,
            y,
            z: pos.z,
            type: 'branch' as TreeBlockType,
            growthOrder: baseGrowthOrder + addedCount,
            symmetryGroup: groupId,
            branchDepth: 1,
          });
          if (anchorIndex === -1) anchorIndex = allBlocks.length - 1;
          addedCount++;
        }
      }

      // Decorations on radius-1 blocks
      if (anchorIndex >= 0 && canPlaceDecoration(x, y, z, decorPositions)) {
        const anchorGroup = allBlocks[anchorIndex]?.symmetryGroup ?? groupId;
        let placed = false;

        if (!placed && opts.spikeChance > 0 && rng() < opts.spikeChance) {
          addSpikeWithSymmetry(allBlocks, occupied, x, y, z, opts.spikeLength, anchorIndex, anchorGroup, rng, treeBaseX, treeBaseZ, symmetryMode, 1, direction);
          placed = true;
        }
        if (!placed && opts.nobChance > 0 && rng() < opts.nobChance) {
          addNobWithSymmetry(allBlocks, occupied, x, y, z, opts.nobSize, anchorIndex, anchorGroup, rng, treeBaseX, treeBaseZ, symmetryMode, 1, direction);
          placed = true;
        }
        if (!placed && opts.crossChance > 0 && rng() < opts.crossChance) {
          addCrossWithSymmetry(allBlocks, occupied, x, y, z, direction, opts.crossLength, anchorIndex, anchorGroup, treeBaseX, treeBaseZ, symmetryMode, 1);
          placed = true;
        }
        if (!placed && opts.shroomChance > 0 && rng() < opts.shroomChance) {
          addShroomWithSymmetry(allBlocks, occupied, x, y, z, opts.shroomLength, opts.shroomCapDiameter, anchorIndex, anchorGroup, treeBaseX, treeBaseZ, symmetryMode, 1, direction);
          placed = true;
        }
        if (!placed && opts.shrineChance > 0 && rng() < opts.shrineChance) {
          addShrineWithSymmetry(allBlocks, occupied, x, y, z, anchorIndex, anchorGroup, treeBaseX, treeBaseZ, symmetryMode, 1, direction);
          placed = true;
        }

        if (placed) {
          decorPositions.push({ x, y, z });
        }
      }

      // Sub-branch chance at radius 1
      if (rng() < 0.2 && i > 1) {
        const perpDirs: [number, number][] = symmetryMode === 'none'
          ? (direction[0] === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]])
          : (direction[0] === 0 ? [[1, 0]] : [[0, 1]]);
        const subDir = seededChoice(perpDirs, rng);
        const subLength = seededInt(2, 5, rng);

        let sx = x;
        let sy = y;
        let sz = z;

        for (let si = 0; si < subLength; si++) {
          sx += subDir[0];
          sz += subDir[1];
          if (rng() < 0.3) sy += 1;

          const subGroupId = baseGroupId + groupsUsed;
          groupsUsed++;

          const subPositions = applySymmetry(sx, sz, treeBaseX, treeBaseZ, symmetryMode);
          let subAnchorIndex = -1;
          for (const pos of subPositions) {
            const key = `${pos.x},${sy},${pos.z}`;
            if (!occupied.has(key)) {
              occupied.add(key);
              allBlocks.push({
                x: pos.x,
                y: sy,
                z: pos.z,
                type: 'branch' as TreeBlockType,
                growthOrder: baseGrowthOrder + addedCount,
                symmetryGroup: subGroupId,
                branchDepth: 2,
              });
              if (subAnchorIndex === -1) subAnchorIndex = allBlocks.length - 1;
              addedCount++;
            }
          }

          // Decorations on sub-branch tips
          if (subAnchorIndex >= 0 && si === subLength - 1 && canPlaceDecoration(sx, sy, sz, decorPositions)) {
            const subAnchorGroup = allBlocks[subAnchorIndex]?.symmetryGroup ?? subGroupId;
            let placed = false;

            if (!placed && opts.spikeChance > 0 && rng() < opts.spikeChance) {
              addSpikeWithSymmetry(allBlocks, occupied, sx, sy, sz, opts.spikeLength, subAnchorIndex, subAnchorGroup, rng, treeBaseX, treeBaseZ, symmetryMode, 2, subDir);
              placed = true;
            }
            if (!placed && opts.nobChance > 0 && rng() < opts.nobChance) {
              addNobWithSymmetry(allBlocks, occupied, sx, sy, sz, opts.nobSize, subAnchorIndex, subAnchorGroup, rng, treeBaseX, treeBaseZ, symmetryMode, 2, subDir);
              placed = true;
            }

            if (placed) decorPositions.push({ x: sx, y: sy, z: sz });
          }
        }
      }
    }

    // Advance position
    x += direction[0];
    z += direction[1];
  }

  return { addedCount, groupsUsed };
}
