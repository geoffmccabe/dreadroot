/**
 * Wide Tree Trunk Generator
 *
 * Generates tapering hollow trunks with door and spiral staircase.
 * Trunk tapers from tier-dependent base radius down to 1 at top.
 * Tier 1-2: solid (too thin for hollow). Tier 3+: hollow with staircase and door.
 * Supports lean angle and S-curve bending (same algorithm as fungal trees).
 */

import { BlueprintBlock, TreeBlockType, SeedDefinition } from '../types';
import { seededRange } from './seededRandom';
import { getRingBlocks, getDiskBlocks } from './cylinderMath';
import {
  WIDE_DOOR_WIDTH,
  WIDE_DOOR_HEIGHT,
  WIDE_STAIR_INNER_RADIUS,
  WIDE_STAIR_BLOCKS_PER_ROTATION,
  WIDE_BLOCK_TYPES,
  WIDE_GLOW_BARK_COVERAGE,
  isWideTreeHollow,
} from './wideTreeConstants';

/**
 * Stem shape configuration (same as fungal tree pattern)
 */
export interface WideShapeConfig {
  stemRandom: number;
  leanAngle: number;
  leanDirX: number;
  leanDirZ: number;
  sCurve: boolean;
  sCurveDirX: number;
  sCurveDirZ: number;
  sCurveMagnitude: number;
}

/**
 * Create shape config from seed definition and RNG
 */
export function createWideShapeConfig(seedDefinition: SeedDefinition | undefined, rng: () => number): WideShapeConfig {
  const stemRandom = seedDefinition?.wide_stem_random ?? 0;
  const leanAngle = seedDefinition?.wide_lean_angle ?? 0;
  const sCurve = seedDefinition?.wide_s_curve ?? false;

  const leanDir = rng() * 2 * Math.PI;
  const sCurveDir = rng() * 2 * Math.PI;
  const baseHeight = seedDefinition?.wide_max_height ?? 100;
  const sCurveMagnitude = sCurve ? seededRange(baseHeight * 0.05, baseHeight * 0.15, rng) : 0;

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
 * Get center offset for the trunk at a given Y level (lean + S-curve).
 * Same algorithm as fungal tree's getStemCenterOffset.
 */
export function getTrunkCenterOffset(
  y: number,
  baseY: number,
  height: number,
  config: WideShapeConfig
): { offsetX: number; offsetZ: number } {
  const dy = y - baseY;
  let offsetX = 0;
  let offsetZ = 0;

  if (config.leanAngle > 0) {
    const leanRadians = (config.leanAngle * Math.PI) / 180;
    const leanOffset = dy * Math.tan(leanRadians);
    offsetX += leanOffset * config.leanDirX;
    offsetZ += leanOffset * config.leanDirZ;
  }

  if (config.sCurve && height > 6) {
    const third = height / 3;
    const progress = dy;
    if (progress >= third && progress < third * 2) {
      const bendProgress = (progress - third) / third;
      const bendAmount = Math.sin(bendProgress * Math.PI) * config.sCurveMagnitude;
      offsetX += bendAmount * config.sCurveDirX;
      offsetZ += bendAmount * config.sCurveDirZ;
    }
  }

  return {
    offsetX: Math.round(offsetX),
    offsetZ: Math.round(offsetZ),
  };
}

/**
 * Calculate the trunk radius at a given height (linear taper from baseRadius to 1).
 */
function getTrunkRadiusAtHeight(y: number, baseY: number, height: number, baseRadius: number): number {
  if (height <= 1) return baseRadius;
  const t = (y - baseY) / (height - 1); // 0 at base, 1 at top
  return Math.max(1, Math.round(baseRadius - (baseRadius - 1) * t));
}

/**
 * Calculate door positions to carve out of the trunk wall.
 * Door is 3 wide, 4 tall, follows lean/S-curve.
 */
function getDoorPositions(
  centerX: number,
  baseY: number,
  centerZ: number,
  baseRadius: number,
  height: number,
  shapeConfig: WideShapeConfig
): Set<string> {
  const positions = new Set<string>();

  for (let dy = 0; dy < WIDE_DOOR_HEIGHT; dy++) {
    const y = baseY + dy;
    const { offsetX, offsetZ } = getTrunkCenterOffset(y, baseY, height, shapeConfig);
    const layerCX = centerX + offsetX;
    const layerCZ = centerZ + offsetZ;

    const layerRadius = getTrunkRadiusAtHeight(y, baseY, height, baseRadius);

    // Carve door through the wall on the +Z side
    for (let dz = layerRadius - 1; dz <= layerRadius + 2; dz++) {
      const halfWidth = Math.floor(WIDE_DOOR_WIDTH / 2);
      for (let dx = -halfWidth; dx <= halfWidth; dx++) {
        positions.add(`${layerCX + dx},${y},${layerCZ + dz}`);
      }
    }
  }

  return positions;
}

/**
 * Build the tapering trunk (hollow for tier 3+, solid for tier 1-2).
 * Returns trunk blocks + the occupied set of position keys.
 */
export function buildWideTrunk(
  centerX: number,
  baseY: number,
  centerZ: number,
  height: number,
  baseRadius: number,
  tier: number,
  shapeConfig: WideShapeConfig,
  stemRandomRng: () => number,
  glowRng: () => number,
  glowColor: string | null
): { blocks: BlueprintBlock[]; doorPositions: Set<string> } {
  const blocks: BlueprintBlock[] = [];
  const hollow = isWideTreeHollow(tier);

  // Get door positions (only for hollow trees)
  const doorPositions = hollow
    ? getDoorPositions(centerX, baseY, centerZ, baseRadius, height, shapeConfig)
    : new Set<string>();

  let growthOrder = 1; // 0 is reserved for seed block

  for (let y = baseY; y < baseY + height; y++) {
    const { offsetX, offsetZ } = getTrunkCenterOffset(y, baseY, height, shapeConfig);
    const layerCX = centerX + offsetX;
    const layerCZ = centerZ + offsetZ;

    let layerRadius = getTrunkRadiusAtHeight(y, baseY, height, baseRadius);

    // Apply stem random variation
    if (shapeConfig.stemRandom > 0 && layerRadius > 1) {
      const scaledRandom = Math.max(1, Math.round(shapeConfig.stemRandom * (layerRadius / 7)));
      const variation = Math.floor(stemRandomRng() * (scaledRandom * 2 + 1)) - scaledRandom;
      layerRadius = Math.max(1, layerRadius + variation);
    }

    // Get blocks for this layer
    const layerBlocks = hollow && layerRadius >= 3
      ? getRingBlocks(layerCX, y, layerCZ, layerRadius)
      : getDiskBlocks(layerCX, y, layerCZ, layerRadius);

    for (const pos of layerBlocks) {
      const posKey = `${pos.x},${pos.y},${pos.z}`;
      if (doorPositions.has(posKey)) continue;

      blocks.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        type: WIDE_BLOCK_TYPES.TRUNK as TreeBlockType,
        growthOrder: growthOrder,
        branchDepth: -1,
      });
    }

    growthOrder++;
  }

  // Glow bark pass: convert ~30% of trunk blocks to glow_bark
  if (glowColor) {
    for (const block of blocks) {
      if (glowRng() < WIDE_GLOW_BARK_COVERAGE) {
        block.type = WIDE_BLOCK_TYPES.GLOW_BARK as TreeBlockType;
      }
    }
  }

  return { blocks, doorPositions };
}

/**
 * Build spiral staircase inside the hollow trunk.
 * Only for tier 3+ (hollow trees).
 */
export function buildWideStaircase(
  centerX: number,
  baseY: number,
  centerZ: number,
  height: number,
  baseRadius: number,
  shapeConfig: WideShapeConfig,
  startingGrowthOrder: number = 1000
): BlueprintBlock[] {
  const blocks: BlueprintBlock[] = [];
  let growthOrder = startingGrowthOrder;
  const seen = new Set<string>();

  const stairBaseY = baseY + 1; // Start above door base
  const totalSteps = height - 1;

  for (let step = 0; step < totalSteps; step++) {
    const angle = (step / WIDE_STAIR_BLOCKS_PER_ROTATION) * 2 * Math.PI;
    const y = stairBaseY + step;

    const { offsetX, offsetZ } = getTrunkCenterOffset(y, baseY, height, shapeConfig);
    const stairCX = centerX + offsetX;
    const stairCZ = centerZ + offsetZ;

    // Stair outer radius tapers with trunk
    const trunkR = Math.max(1, Math.round(baseRadius - (baseRadius - 1) * ((y - baseY) / (height - 1))));
    const stairOuterRadius = Math.min(trunkR - 1, WIDE_STAIR_INNER_RADIUS + 2);

    if (stairOuterRadius < WIDE_STAIR_INNER_RADIUS) continue; // Too narrow for stairs

    for (let r = WIDE_STAIR_INNER_RADIUS; r <= stairOuterRadius; r++) {
      const x = Math.round(stairCX + r * Math.cos(angle));
      const z = Math.round(stairCZ + r * Math.sin(angle));
      const key = `${x},${y},${z}`;

      if (!seen.has(key)) {
        seen.add(key);
        blocks.push({
          x,
          y,
          z,
          type: WIDE_BLOCK_TYPES.STAIRS as TreeBlockType,
          growthOrder: growthOrder++,
          branchDepth: 0,
        });
      }
    }
  }

  return blocks;
}
