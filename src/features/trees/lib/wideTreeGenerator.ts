/**
 * Wide Tree Generator
 *
 * Main entry point for generating wide tree blueprints.
 * Combines tapering trunk, optional staircase, thick branches with decorations,
 * and glow bark. Supports lean angle, S-curve, and symmetry.
 */

import { BlueprintBlock, TreeBlueprint, TreeBlockType, SeedDefinition, TreeGrowthOptions, SymmetryMode, RootStyle } from '../types';
import { createSeededRandom, seededInt } from './seededRandom';
import {
  WIDE_MAX_TIERS,
  WIDE_BLOCK_TYPES,
  WIDE_TIER_DEFAULTS,
  isWideTreeHollow,
} from './wideTreeConstants';
import { buildWideTrunk, buildWideStaircase, createWideShapeConfig } from './wideTreeTrunk';
import { generateWideBranches } from './wideTreeBranches';
import { generateRoots } from './rootGenerator';

/**
 * Generate a complete wide tree blueprint.
 */
export function generateWideTreeBlueprint(
  baseX: number,
  baseY: number,
  baseZ: number,
  tier: number,
  growthSeed: number,
  seedDefinition?: SeedDefinition
): TreeBlueprint {
  const effectiveTier = Math.max(1, Math.min(tier, WIDE_MAX_TIERS));
  const tierDefaults = WIDE_TIER_DEFAULTS[effectiveTier];

  // Base radius (can be overridden by seed definition)
  const baseRadius = seedDefinition?.wide_base_trunk_radius ?? tierDefaults.radius;

  // Height range from seed definition or tier defaults
  const minHeight = seedDefinition?.wide_min_height ?? tierDefaults.minHeight;
  const maxHeight = seedDefinition?.wide_max_height ?? tierDefaults.maxHeight;

  // Randomize height
  const rng = createSeededRandom(growthSeed);
  const height = seededInt(minHeight, maxHeight, rng);

  // Create shape config (lean, S-curve)
  const shapeRng = createSeededRandom(growthSeed + 99999);
  const shapeConfig = createWideShapeConfig(seedDefinition, shapeRng);

  // RNG streams for different purposes
  const stemRandomRng = createSeededRandom(growthSeed + 77777);
  const glowRng = createSeededRandom(growthSeed + 33333);
  const glowColor = seedDefinition?.wide_glow_color ?? '#88ffaa';

  // ============ BUILD ALL PARTS ============
  const allBlocks: BlueprintBlock[] = [];

  // 0. Seed block at base
  allBlocks.push({
    x: baseX,
    y: baseY,
    z: baseZ,
    type: WIDE_BLOCK_TYPES.TRUNK as TreeBlockType,
    growthOrder: 0,
    branchDepth: -1,
  });

  // 1. Trunk (tapering, hollow for tier 3+)
  const { blocks: trunkBlocks, doorPositions } = buildWideTrunk(
    baseX, baseY, baseZ, height, baseRadius,
    effectiveTier, shapeConfig, stemRandomRng, glowRng, glowColor
  );
  allBlocks.push(...trunkBlocks);

  // Calculate next growth order after trunk (sequential, no gaps)
  let nextGrowthOrder = 0;
  for (const block of trunkBlocks) {
    if (block.growthOrder > nextGrowthOrder) nextGrowthOrder = block.growthOrder;
  }
  nextGrowthOrder += 1;

  // 2. Staircase (tier 3+ only)
  if (isWideTreeHollow(effectiveTier) && baseRadius >= 3) {
    const stairBlocks = buildWideStaircase(baseX, baseY, baseZ, height, baseRadius, shapeConfig, nextGrowthOrder);
    allBlocks.push(...stairBlocks);
    // Update next order after staircase
    for (const block of stairBlocks) {
      if (block.growthOrder >= nextGrowthOrder) nextGrowthOrder = block.growthOrder + 1;
    }
  }

  // 3. Branches with decorations
  const symmetryMode: SymmetryMode = seedDefinition?.symmetry ?? 'none';
  const branchingFactor = seedDefinition?.branching_factor ?? 0.5;
  const widthFactor = seedDefinition?.width_factor ?? 0.3;

  const branchOpts: Required<TreeGrowthOptions> = {
    lowBranchHeight: seedDefinition?.low_branch_height ?? Math.floor(height * 0.25),
    spikeChance: seedDefinition?.spike_chance ?? 0,
    spikeLength: Math.max(4, seedDefinition?.spike_length ?? 4),
    nobChance: seedDefinition?.nob_chance ?? 0,
    nobSize: seedDefinition?.nob_size ?? 1,
    crossChance: seedDefinition?.cross_chance ?? 0,
    crossLength: Math.max(4, seedDefinition?.cross_length ?? 4),
    shroomChance: seedDefinition?.shroom_chance ?? 0,
    shroomLength: Math.max(4, seedDefinition?.shroom_length ?? 5),
    shroomCapDiameter: seedDefinition?.shroom_cap_diameter ?? 3,
    symmetry: symmetryMode,
  };

  const branchBlocks = generateWideBranches(
    baseX, baseY, baseZ, height, baseRadius,
    growthSeed, seedDefinition, shapeConfig,
    {
      branchingFactor,
      widthFactor,
      tier: effectiveTier,
      symmetryMode,
      opts: branchOpts,
    },
    glowRng, glowColor,
    nextGrowthOrder
  );
  allBlocks.push(...branchBlocks);

  // ============ ADD ROOTS AS FINAL STEP ============
  const rootStyle: RootStyle = seedDefinition?.root_style ?? 'none';
  if (rootStyle !== 'none') {
    // Build occupied set for root generation
    const occupiedForRoots = new Set<string>();
    for (const block of allBlocks) {
      occupiedForRoots.add(`${block.x},${block.y},${block.z}`);
    }
    // Get max growth order
    const maxOrder = Math.max(...allBlocks.map(b => b.growthOrder));
    // Create RNG for roots
    const rootRng = createSeededRandom(growthSeed + 55555);
    generateRoots(
      allBlocks,
      occupiedForRoots,
      baseX,
      baseY,
      baseZ,
      height,
      baseRadius,
      'wide',
      rootStyle,
      rootRng,
      maxOrder + 1
    );
  }

  // ============ DEDUPLICATE ============
  const seenPositions = new Set<string>();
  const dedupedBlocks: BlueprintBlock[] = [];
  for (const block of allBlocks) {
    const key = `${block.x},${block.y},${block.z}`;
    if (!seenPositions.has(key)) {
      seenPositions.add(key);
      dedupedBlocks.push(block);
    }
  }

  // Calculate dimensions
  let maxWidth = 0;
  for (const block of dedupedBlocks) {
    const dx = Math.abs(block.x - baseX);
    const dz = Math.abs(block.z - baseZ);
    maxWidth = Math.max(maxWidth, dx, dz);
  }

  return {
    blocks: dedupedBlocks,
    maxHeight: height,
    maxWidth: maxWidth * 2,
  };
}

/**
 * Get blocks at a specific growth order (for progressive growth).
 */
export function getWideBlocksAtOrder(
  blueprint: TreeBlueprint,
  order: number
): BlueprintBlock[] {
  return blueprint.blocks.filter(b => b.growthOrder === order);
}

/**
 * Get the maximum growth order in a wide tree blueprint.
 */
export function getWideMaxGrowthOrder(blueprint: TreeBlueprint): number {
  return Math.max(...blueprint.blocks.map(b => b.growthOrder));
}
