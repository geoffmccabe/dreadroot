/**
 * Fungal Tree Generator
 *
 * Generates giant hollow mushroom trees with:
 * - Hollow cylindrical stem (tier-dependent width)
 * - Decorative rings at 2/3 height
 * - Mushroom cap with tapered edges
 * - Interior spiral staircase
 * - Door at base for entry
 * - Optional: ribbed stem wall, lean angle, S-curve
 *
 * Uses seeded random for deterministic generation.
 */

import { BlueprintBlock, TreeBlueprint, TreeBlockType, SeedDefinition } from '../types';
import { createSeededRandom, seededInt, seededRange } from './seededRandom';
import {
  FUNGAL_MIN_HEIGHT,
  FUNGAL_MAX_HEIGHT,
  FUNGAL_RING_HEIGHT_RATIO,
  FUNGAL_RING_PROTRUSION,
  FUNGAL_RING_SPACING,
  FUNGAL_RING_COUNT,
  FUNGAL_MIN_CAP_WIDTH,
  FUNGAL_MAX_CAP_WIDTH,
  FUNGAL_CAP_THICKNESS,
  FUNGAL_COLUMN_SPACING,
  FUNGAL_COLUMN_HEIGHT,
  FUNGAL_DOOR_WIDTH,
  FUNGAL_DOOR_HEIGHT,
  FUNGAL_STAIR_INNER_RADIUS,
  FUNGAL_STAIR_BLOCKS_PER_ROTATION,
  FUNGAL_BLOCK_TYPES,
  FUNGAL_MAX_TIERS,
} from './fungalTreeConstants';

/**
 * Calculate stem radius based on tier
 * Tier 1 = 11 blocks wide (radius 5)
 * Tier 10 = 29 blocks wide (radius 14)
 * Formula: radius = 4 + tier
 */
function getStemRadiusForTier(tier: number): number {
  return 4 + tier;
}
import {
  getRingBlocks,
  getDiskBlocks,
  getAnnulusBlocks,
  getCirclePositions,
  Position,
} from './cylinderMath';

interface FungalTreeParams {
  stemHeight: number;
  capWidth: number;
  capRadius: number;
  ringHeight: number; // Y position where rings start
}

/**
 * Stem shape configuration derived from seed definition
 */
interface StemShapeConfig {
  stemRandom: number;      // 0-3 wall thickness variation
  leanAngle: number;       // 0-30 degrees lean
  leanDirX: number;        // lean direction X component (unit)
  leanDirZ: number;        // lean direction Z component (unit)
  sCurve: boolean;         // whether S-curve is enabled
  sCurveDirX: number;      // S-curve bend direction X
  sCurveDirZ: number;      // S-curve bend direction Z
  sCurveMagnitude: number; // S-curve bend magnitude (blocks)
}

/**
 * Get the center offset for the stem at a given Y level.
 * Combines lean angle and S-curve into a single offset.
 */
function getStemCenterOffset(
  y: number,
  baseY: number,
  height: number,
  config: StemShapeConfig
): { offsetX: number; offsetZ: number } {
  const dy = y - baseY;
  let offsetX = 0;
  let offsetZ = 0;

  // Lean: linear offset based on height
  if (config.leanAngle > 0) {
    const leanRadians = (config.leanAngle * Math.PI) / 180;
    const leanOffset = dy * Math.tan(leanRadians);
    offsetX += leanOffset * config.leanDirX;
    offsetZ += leanOffset * config.leanDirZ;
  }

  // S-curve: bend in middle third, return to vertical in top third
  if (config.sCurve && height > 6) {
    const third = height / 3;
    const progress = dy;

    if (progress >= third && progress < third * 2) {
      // Middle third: bend outward using sine curve
      const bendProgress = (progress - third) / third; // 0 to 1
      const bendAmount = Math.sin(bendProgress * Math.PI) * config.sCurveMagnitude;
      offsetX += bendAmount * config.sCurveDirX;
      offsetZ += bendAmount * config.sCurveDirZ;
    }
    // Top third and bottom third: no S-curve offset (straight)
  }

  return {
    offsetX: Math.round(offsetX),
    offsetZ: Math.round(offsetZ),
  };
}

/**
 * Generate randomized parameters for a fungal tree
 */
function randomizeFungalParams(seed: number, tier: number, seedDefinition?: SeedDefinition): FungalTreeParams {
  const rng = createSeededRandom(seed);

  const minHeight = seedDefinition?.fungal_min_height ?? FUNGAL_MIN_HEIGHT;
  const maxHeight = seedDefinition?.fungal_max_height ?? FUNGAL_MAX_HEIGHT;
  const minCapWidth = seedDefinition?.fungal_min_cap_width ?? FUNGAL_MIN_CAP_WIDTH;
  const maxCapWidth = seedDefinition?.fungal_max_cap_width ?? FUNGAL_MAX_CAP_WIDTH;

  const stemHeight = seededInt(minHeight, maxHeight, rng);
  let capWidth = seededInt(minCapWidth, maxCapWidth, rng);

  // Clamp cap width to max 3x stem diameter to prevent absurdly wide caps
  const stemDiameter = (4 + Math.min(tier, FUNGAL_MAX_TIERS)) * 2;
  const maxAllowedCap = stemDiameter * 3;
  capWidth = Math.min(capWidth, maxAllowedCap);

  return {
    stemHeight,
    capWidth,
    capRadius: Math.floor(capWidth / 2),
    ringHeight: Math.floor(stemHeight * FUNGAL_RING_HEIGHT_RATIO),
  };
}

/**
 * Create stem shape configuration from seed definition and RNG
 */
function createStemShapeConfig(seedDefinition: SeedDefinition | undefined, rng: () => number): StemShapeConfig {
  const stemRandom = seedDefinition?.fungal_stem_random ?? 0;
  const leanAngle = seedDefinition?.fungal_lean_angle ?? 0;
  const sCurve = seedDefinition?.fungal_s_curve ?? false;

  // Random lean direction
  const leanDir = rng() * 2 * Math.PI;

  // Random S-curve direction (perpendicular or independent from lean)
  const sCurveDir = rng() * 2 * Math.PI;
  // S-curve magnitude: 10-30 degree equivalent offset over height/3
  const sCurveMagnitude = sCurve ? seededRange(3, 8, rng) : 0;

  return {
    stemRandom,
    leanAngle,
    leanDirX: Math.cos(leanDir),
    leanDirZ: Math.sin(leanDir),
    sCurve,
    sCurveDirX: Math.cos(sCurveDir),
    sCurveDirZ: Math.sin(sCurveDir),
    sCurveMagnitude,
  };
}

/**
 * Build the hollow cylindrical stem with optional ribbing, lean, and S-curve
 */
function buildStem(
  centerX: number,
  baseY: number,
  centerZ: number,
  height: number,
  doorPositions: Set<string>,
  stemRadius: number,
  shapeConfig: StemShapeConfig,
  stemRandomRng: () => number
): BlueprintBlock[] {
  const blocks: BlueprintBlock[] = [];
  let growthOrder = 0;

  for (let y = baseY; y < baseY + height; y++) {
    // Get center offset for this layer (lean + S-curve)
    const { offsetX, offsetZ } = getStemCenterOffset(y, baseY, height, shapeConfig);
    const layerCenterX = centerX + offsetX;
    const layerCenterZ = centerZ + offsetZ;

    // Stem random: vary radius per layer
    let layerRadius = stemRadius;
    if (shapeConfig.stemRandom > 0) {
      layerRadius = stemRadius + seededInt(-shapeConfig.stemRandom, shapeConfig.stemRandom, stemRandomRng);
      layerRadius = Math.max(3, layerRadius); // minimum radius of 3
    }

    const ringBlocks = getRingBlocks(layerCenterX, y, layerCenterZ, layerRadius);

    for (const pos of ringBlocks) {
      const posKey = `${pos.x},${pos.y},${pos.z}`;
      if (doorPositions.has(posKey)) continue;

      blocks.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        type: FUNGAL_BLOCK_TYPES.STEM as TreeBlockType,
        growthOrder: growthOrder++,
        branchDepth: -1,
      });
    }
  }

  return blocks;
}

/**
 * Calculate door positions to carve out.
 * Follows the stem's lean/S-curve so the door stays on the stem wall at each Y level.
 */
function getDoorPositions(
  centerX: number,
  baseY: number,
  centerZ: number,
  radius: number,
  height: number,
  shapeConfig: StemShapeConfig
): Set<string> {
  const positions = new Set<string>();

  for (let dy = 0; dy < FUNGAL_DOOR_HEIGHT; dy++) {
    const y = baseY + dy;
    const { offsetX, offsetZ } = getStemCenterOffset(y, baseY, height, shapeConfig);
    const layerCX = centerX + offsetX;
    const layerCZ = centerZ + offsetZ;
    const doorZ = layerCZ + radius;

    for (let dx = -Math.floor(FUNGAL_DOOR_WIDTH / 2); dx <= Math.floor(FUNGAL_DOOR_WIDTH / 2); dx++) {
      positions.add(`${layerCX + dx},${y},${doorZ}`);
    }
  }

  return positions;
}

/**
 * Build the decorative rings that protrude from the stem
 */
function buildRings(
  centerX: number,
  ringBaseY: number,
  centerZ: number,
  stemRadius: number,
  baseY: number,
  height: number,
  shapeConfig: StemShapeConfig
): BlueprintBlock[] {
  const blocks: BlueprintBlock[] = [];
  let growthOrder = 1000;

  const innerRadius = stemRadius;
  const outerRadius = stemRadius + FUNGAL_RING_PROTRUSION;

  for (let ring = 0; ring < FUNGAL_RING_COUNT; ring++) {
    const y = ringBaseY + (ring * FUNGAL_RING_SPACING);
    const { offsetX, offsetZ } = getStemCenterOffset(y, baseY, height, shapeConfig);
    const ringCX = centerX + offsetX;
    const ringCZ = centerZ + offsetZ;

    const ringBlocks = getAnnulusBlocks(ringCX, y, ringCZ, innerRadius + 1, outerRadius);

    for (const pos of ringBlocks) {
      blocks.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        type: FUNGAL_BLOCK_TYPES.RINGS as TreeBlockType,
        growthOrder: growthOrder++,
        branchDepth: 0,
      });
    }
  }

  return blocks;
}

/**
 * Build support columns from stem top to cap
 */
function buildSupportColumns(
  centerX: number,
  stemTopY: number,
  centerZ: number,
  stemRadius: number,
  topOffsetX: number,
  topOffsetZ: number
): BlueprintBlock[] {
  const blocks: BlueprintBlock[] = [];
  let growthOrder = 2000;

  const colCX = centerX + topOffsetX;
  const colCZ = centerZ + topOffsetZ;

  const columnPositions = getCirclePositions(colCX, colCZ, stemRadius, FUNGAL_COLUMN_SPACING);

  for (const pos of columnPositions) {
    for (let dy = 1; dy <= FUNGAL_COLUMN_HEIGHT; dy++) {
      blocks.push({
        x: pos.x,
        y: stemTopY + dy,
        z: pos.z,
        type: FUNGAL_BLOCK_TYPES.COLUMNS as TreeBlockType,
        growthOrder: growthOrder++,
        branchDepth: 0,
      });
    }
  }

  return blocks;
}

/**
 * Build the mushroom cap
 * Has a hole through the center for the staircase
 */
function buildMushroomCap(
  centerX: number,
  capBottomY: number,
  centerZ: number,
  capRadius: number,
  stemRadius: number,
  topOffsetX: number,
  topOffsetZ: number
): BlueprintBlock[] {
  const blocks: BlueprintBlock[] = [];
  let growthOrder = 3000;

  const capCX = centerX + topOffsetX;
  const capCZ = centerZ + topOffsetZ;

  const holeRadius = FUNGAL_STAIR_INNER_RADIUS;
  const holeRadiusSq = (holeRadius + 0.5) * (holeRadius + 0.5);

  // Pre-compute radii with max 1-block reduction per layer to prevent gaps
  // Layer 0 = top (widest), layer N = bottom (narrowest)
  // Uses quadratic (parabolic) taper: cap stays wide then narrows sharply at bottom,
  // creating a concave/inverted-parabola underside like a real mushroom cap
  const radii: number[] = [];
  let currentRadius = capRadius;
  for (let layer = 0; layer < FUNGAL_CAP_THICKNESS; layer++) {
    const t = layer / (FUNGAL_CAP_THICKNESS - 1); // 0 at top, 1 at bottom
    const targetRadius = Math.round(capRadius - (capRadius - stemRadius) * (t * t));
    currentRadius = Math.max(targetRadius, currentRadius - 1);
    radii.push(currentRadius);
  }

  for (let layer = 0; layer < FUNGAL_CAP_THICKNESS; layer++) {
    const y = capBottomY + (FUNGAL_CAP_THICKNESS - 1 - layer);
    const layerRadius = radii[layer];

    const blockType = layer < FUNGAL_CAP_THICKNESS / 2
      ? FUNGAL_BLOCK_TYPES.CAP_TOP
      : FUNGAL_BLOCK_TYPES.CAP_BOTTOM;

    const diskBlocks = getDiskBlocks(capCX, y, capCZ, layerRadius);

    for (const pos of diskBlocks) {
      const dx = pos.x - capCX;
      const dz = pos.z - capCZ;
      if (dx * dx + dz * dz <= holeRadiusSq) continue;

      blocks.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        type: blockType as TreeBlockType,
        growthOrder: growthOrder++,
        branchDepth: 1,
      });
    }
  }

  return blocks;
}

/**
 * Build the interior spiral staircase
 */
function buildSpiralStaircase(
  centerX: number,
  baseY: number,
  centerZ: number,
  stairBaseY: number,
  totalHeight: number,
  stemHeight: number,
  stemRadius: number,
  shapeConfig: StemShapeConfig,
  topOffsetX: number,
  topOffsetZ: number
): BlueprintBlock[] {
  const blocks: BlueprintBlock[] = [];
  let growthOrder = 4000;
  const seen = new Set<string>();

  const stairOuterRadius = stemRadius - 1;
  const stairInnerRadius = FUNGAL_STAIR_INNER_RADIUS;
  const totalSteps = totalHeight;

  for (let step = 0; step < totalSteps; step++) {
    const angle = (step / FUNGAL_STAIR_BLOCKS_PER_ROTATION) * 2 * Math.PI;
    const y = stairBaseY + step;

    // Use stem center offset for stair position if within stem height
    let stairCX: number;
    let stairCZ: number;
    if (y <= baseY + stemHeight) {
      const { offsetX, offsetZ } = getStemCenterOffset(y, baseY, stemHeight, shapeConfig);
      stairCX = centerX + offsetX;
      stairCZ = centerZ + offsetZ;
    } else {
      // Above stem: use top offset (cap position)
      stairCX = centerX + topOffsetX;
      stairCZ = centerZ + topOffsetZ;
    }

    for (let r = stairInnerRadius; r <= stairOuterRadius; r++) {
      const x = Math.round(stairCX + r * Math.cos(angle));
      const z = Math.round(stairCZ + r * Math.sin(angle));
      const key = `${x},${y},${z}`;

      if (!seen.has(key)) {
        seen.add(key);
        blocks.push({
          x,
          y,
          z,
          type: FUNGAL_BLOCK_TYPES.STAIRS as TreeBlockType,
          growthOrder: growthOrder++,
          branchDepth: 0,
        });
      }
    }
  }

  return blocks;
}

/**
 * Generate invisiblocks around the fungal tree for collision
 */
function generateInvisiblocks(
  centerX: number,
  baseY: number,
  stemHeight: number,
  capRadius: number,
  occupiedPositions: Set<string>,
  topOffsetX: number,
  topOffsetZ: number
): BlueprintBlock[] {
  const blocks: BlueprintBlock[] = [];
  let growthOrder = 5000;

  const capBottomY = baseY + stemHeight - 1 + FUNGAL_COLUMN_HEIGHT;

  const invisiRadius = capRadius + 1;
  const ringBlocks = getRingBlocks(centerX + topOffsetX, capBottomY, centerX + topOffsetZ, invisiRadius);

  for (const pos of ringBlocks) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (!occupiedPositions.has(key)) {
      blocks.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        type: 'invisiblock' as TreeBlockType,
        growthOrder: growthOrder++,
        branchDepth: 0,
      });
    }
  }

  return blocks;
}

/**
 * Main function to generate a complete fungal tree blueprint
 */
export function generateFungalTreeBlueprint(
  baseX: number,
  baseY: number,
  baseZ: number,
  tier: number,
  growthSeed: number,
  seedDefinition?: SeedDefinition
): TreeBlueprint {
  const effectiveTier = Math.min(tier, FUNGAL_MAX_TIERS);
  const stemRadius = getStemRadiusForTier(effectiveTier);

  // Randomize tree parameters using per-seed values
  const params = randomizeFungalParams(growthSeed, effectiveTier, seedDefinition);

  // Scale height by tier
  const scaledHeight = Math.round(params.stemHeight * (0.5 + (effectiveTier / FUNGAL_MAX_TIERS) * 0.5));

  // Create shape config from a separate RNG stream (offset seed to avoid correlation)
  const shapeRng = createSeededRandom(growthSeed + 99999);
  const shapeConfig = createStemShapeConfig(seedDefinition, shapeRng);

  // Create another RNG for stem random variation
  const stemRandomRng = createSeededRandom(growthSeed + 77777);

  // Get stem top center offset (used for cap, columns, etc.)
  const topOffset = getStemCenterOffset(baseY + scaledHeight - 1, baseY, scaledHeight, shapeConfig);

  // Track all occupied positions
  const occupiedPositions = new Set<string>();

  // Calculate key Y positions
  // Cap sits directly on top of columns — no gap
  const stemTopY = baseY + scaledHeight - 1;
  const capBottomY = stemTopY + FUNGAL_COLUMN_HEIGHT;

  // Get door positions to carve out (follows lean/S-curve)
  const doorPositions = getDoorPositions(baseX, baseY, baseZ, stemRadius, scaledHeight, shapeConfig);

  // Generate all parts
  const allBlocks: BlueprintBlock[] = [];

  // 0. Place center seed block at base position (growthOrder 0)
  allBlocks.push({
    x: baseX,
    y: baseY,
    z: baseZ,
    type: FUNGAL_BLOCK_TYPES.STEM as TreeBlockType,
    growthOrder: 0,
    branchDepth: -1,
  });

  // 1. Build stem (hollow cylinder with door, lean, S-curve, ribbing)
  const stemBlocks = buildStem(baseX, baseY, baseZ, scaledHeight, doorPositions, stemRadius, shapeConfig, stemRandomRng);
  for (const block of stemBlocks) {
    block.growthOrder += 1;
  }
  allBlocks.push(...stemBlocks);

  // 2. Build decorative rings
  const ringY = baseY + Math.floor(scaledHeight * FUNGAL_RING_HEIGHT_RATIO);
  const ringBlocks = buildRings(baseX, ringY, baseZ, stemRadius, baseY, scaledHeight, shapeConfig);
  allBlocks.push(...ringBlocks);

  // 3. Build support columns (at stem top offset)
  const columnBlocks = buildSupportColumns(baseX, stemTopY, baseZ, stemRadius, topOffset.offsetX, topOffset.offsetZ);
  allBlocks.push(...columnBlocks);

  // 4. Build mushroom cap (at top offset)
  const capBlocks = buildMushroomCap(baseX, capBottomY, baseZ, params.capRadius, stemRadius, topOffset.offsetX, topOffset.offsetZ);
  allBlocks.push(...capBlocks);

  // 5. Build spiral staircase inside (extends through stem + columns + cap)
  const capTopY = capBottomY + FUNGAL_CAP_THICKNESS;
  const totalStairHeight = capTopY - (baseY + 1);
  const stairBlocks = buildSpiralStaircase(
    baseX, baseY, baseZ, baseY + 1, totalStairHeight, scaledHeight, stemRadius,
    shapeConfig, topOffset.offsetX, topOffset.offsetZ
  );
  allBlocks.push(...stairBlocks);

  // Track all occupied positions for invisiblock placement
  for (const block of allBlocks) {
    occupiedPositions.add(`${block.x},${block.y},${block.z}`);
  }

  // 6. Add invisiblocks
  const invisiblocks = generateInvisiblocks(
    baseX, baseY, scaledHeight, params.capRadius,
    occupiedPositions, topOffset.offsetX, topOffset.offsetZ
  );
  allBlocks.push(...invisiblocks);

  // Deduplicate blocks
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
  const maxHeight = capBottomY + FUNGAL_CAP_THICKNESS - baseY;
  const maxWidth = params.capWidth;

  return {
    blocks: dedupedBlocks,
    maxHeight,
    maxWidth,
  };
}

/**
 * Get blocks at a specific growth order (for progressive growth)
 */
export function getFungalBlocksAtOrder(
  blueprint: TreeBlueprint,
  order: number
): BlueprintBlock[] {
  return blueprint.blocks.filter(b => b.growthOrder === order);
}

/**
 * Get all blocks up to a specific growth order
 */
export function getFungalBlocksUpToOrder(
  blueprint: TreeBlueprint,
  maxOrder: number
): BlueprintBlock[] {
  return blueprint.blocks.filter(b => b.growthOrder <= maxOrder);
}

/**
 * Get the maximum growth order in a blueprint
 */
export function getFungalMaxGrowthOrder(blueprint: TreeBlueprint): number {
  return Math.max(...blueprint.blocks.map(b => b.growthOrder));
}
