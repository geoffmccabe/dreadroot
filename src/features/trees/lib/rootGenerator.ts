/**
 * Buttress Root Generator
 *
 * Generates buttress roots that extend outward and downward from the trunk base
 * like rocket fins, creating triangular structures players can climb.
 *
 * Roots are added as the FINAL decoration step (highest growthOrder) so they
 * appear last during tree growth animation.
 */

import { BlueprintBlock, RootStyle, TreeType } from '../types';

// Original trees: 4 roots in cross pattern (+X, -X, +Z, -Z)
const CROSS_DIRS = [
  { dx: 1, dz: 0 },   // +X
  { dx: -1, dz: 0 },  // -X
  { dx: 0, dz: 1 },   // +Z
  { dx: 0, dz: -1 },  // -Z
];

// Wide/Fungal trees: 6 roots in hex-ish pattern
// Two aligned with X-axis, others at ~63° (atan2(2,1) ≈ 63°)
const HEXISH_DIRS = [
  { dx: 1, dz: 0 },    // 0° (+X aligned)
  { dx: 1, dz: 2 },    // ~63° (approximates 60°)
  { dx: -1, dz: 2 },   // ~117° (approximates 120°)
  { dx: -1, dz: 0 },   // 180° (-X aligned)
  { dx: -1, dz: -2 },  // ~243° (approximates 240°)
  { dx: 1, dz: -2 },   // ~297° (approximates 300°)
];

/**
 * Add perpendicular thickness blocks for buttress effect
 */
function addButtressThickness(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  x: number, y: number, z: number,
  dirX: number, dirZ: number,
  growthOrder: number
): void {
  // Normalize direction for perpendicular calculation
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (len === 0) return;

  const normX = dirX / len;
  const normZ = dirZ / len;

  // Perpendicular: swap and negate one component
  const perpX = Math.round(-normZ);
  const perpZ = Math.round(normX);

  // Add blocks on both sides
  for (const side of [1, -1]) {
    const px = x + perpX * side;
    const pz = z + perpZ * side;
    const key = `${px},${y},${pz}`;

    if (!occupied.has(key)) {
      blocks.push({
        x: px, y, z: pz,
        type: 'root',
        growthOrder,
        branchDepth: -1, // Same as trunk
      });
      occupied.add(key);
    }
  }
}

/**
 * Place a root block with branch intersection handling
 * If position is occupied by branch, carve 2-block vertical hole for climbing
 */
function placeRootBlock(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  x: number, y: number, z: number,
  growthOrder: number,
  dirX: number, dirZ: number
): void {
  const key = `${x},${y},${z}`;

  // Check if position is occupied by a branch
  if (occupied.has(key)) {
    const existingIdx = blocks.findIndex(b =>
      b.x === x && b.y === y && b.z === z &&
      (b.type === 'branch' || b.type === 'trunk')
    );

    if (existingIdx >= 0 && blocks[existingIdx].type === 'branch') {
      // Carve 2-block vertical hole for climbing
      // Remove this block
      blocks.splice(existingIdx, 1);
      occupied.delete(key);

      // Remove block above if branch
      const aboveKey = `${x},${y + 1},${z}`;
      const aboveIdx = blocks.findIndex(b =>
        b.x === x && b.y === y + 1 && b.z === z && b.type === 'branch'
      );
      if (aboveIdx >= 0) {
        blocks.splice(aboveIdx, 1);
        occupied.delete(aboveKey);
      }
    }
  }

  // Place root block if position now free
  if (!occupied.has(key)) {
    blocks.push({
      x, y, z,
      type: 'root',
      growthOrder,
      branchDepth: -1, // Same as trunk
    });
    occupied.add(key);
  }

  // Add perpendicular thickness for buttress effect
  addButtressThickness(blocks, occupied, x, y, z, dirX, dirZ, growthOrder);
}

/**
 * Carve a 2-tall entrance into the trunk where the root meets it
 */
function carveEntrance(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  startX: number, startY: number, startZ: number,
  dirX: number, dirZ: number,
  trunkRadius: number
): void {
  // Carve INTO trunk (opposite of root direction)
  // Depth scales with trunk radius: min 1 block, max radius blocks
  // This prevents punching through small trunks
  const inwardX = -Math.sign(dirX);
  const inwardZ = -Math.sign(dirZ);
  const entranceDepth = Math.max(1, Math.min(3, trunkRadius));

  for (let d = 0; d < entranceDepth; d++) {
    const x = startX + inwardX * d;
    const z = startZ + inwardZ * d;

    // Remove trunk blocks at entrance height and one above (2-tall doorway)
    for (const yOff of [0, 1]) {
      const key = `${x},${startY + yOff},${z}`;
      const idx = blocks.findIndex(b => b.x === x && b.y === startY + yOff && b.z === z);
      if (idx >= 0) {
        blocks.splice(idx, 1);
        occupied.delete(key);
      }
    }
  }
}

/**
 * Generate a single root from trunk to ground
 */
function generateSingleRoot(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  baseX: number,
  baseY: number,
  baseZ: number,
  treeHeight: number,
  trunkRadius: number,
  dirX: number,
  dirZ: number,
  rootStyle: RootStyle,
  rng: () => number,
  growthOrder: number,
  entranceTrunkRadius: number,
  isWaterPosition?: (x: number, y: number, z: number) => boolean
): void {
  // Starting height: 5-10% of tree height above baseY
  const startHeightPercent = 0.05 + rng() * 0.05;
  const startY = baseY + Math.max(2, Math.floor(treeHeight * startHeightPercent));

  // Starting position: at trunk edge in root direction (properly handles diagonal directions)
  const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
  const startX = baseX + Math.round((dirX / dirLen) * trunkRadius);
  const startZ = baseZ + Math.round((dirZ / dirLen) * trunkRadius);

  // Y drop rate based on style
  const getYDrop = (): number => {
    switch (rootStyle) {
      case 'steep': return 1 + Math.floor(rng() * 2);  // 1-2
      case '45deg': return 1;
      case 'shallow': return rng() < 0.5 ? 0 : 1;  // 0-1
      default: return 1;
    }
  };

  // Horizontal step rate (for shallow, move 2 horizontal per Y drop)
  const hStepsPerDrop = rootStyle === 'shallow' ? 2 : 1;

  let x = startX;
  let y = startY;
  let z = startZ;
  let hStepCount = 0;

  // Descend towards baseY
  while (y > baseY) {
    // Stop if we hit water
    if (isWaterPosition && isWaterPosition(x, y, z)) {
      break;
    }

    // Place root block (checking for branch intersection)
    placeRootBlock(blocks, occupied, x, y, z, growthOrder, dirX, dirZ);

    // Move horizontally
    x += dirX;
    z += dirZ;
    hStepCount++;

    // Drop Y based on style
    if (hStepCount >= hStepsPerDrop) {
      const drop = getYDrop();
      y = Math.max(baseY, y - drop);
      // Add randomness for organic look
      if (rng() < 0.2) y = Math.max(baseY, y - 1);
      hStepCount = 0;
    }
  }

  // Ground extension: 0-3 blocks along ground
  const groundExtension = Math.floor(rng() * 4);
  for (let i = 0; i < groundExtension; i++) {
    x += dirX;
    z += dirZ;
    placeRootBlock(blocks, occupied, x, baseY, z, growthOrder, dirX, dirZ);
  }

  // 50% chance of entrance at root start
  if (rng() < 0.5) {
    carveEntrance(blocks, occupied, startX, startY, startZ, dirX, dirZ, entranceTrunkRadius);
  }
}

/**
 * Generate buttress roots for a tree
 *
 * @param blocks - The blueprint blocks array (mutated)
 * @param occupied - Set of occupied position keys (mutated)
 * @param baseX - Tree base X coordinate
 * @param baseY - Tree base Y coordinate (ground level)
 * @param baseZ - Tree base Z coordinate
 * @param treeHeight - Total tree height
 * @param trunkRadius - Trunk radius (1 for original trees)
 * @param treeType - Type of tree (determines 4 or 6 roots)
 * @param rootStyle - Root style (steep, 45deg, shallow)
 * @param rng - Seeded random number generator
 * @param rootsGrowthOrder - Growth order for root blocks (should be maxOrder + 1)
 */
export function generateRoots(
  blocks: BlueprintBlock[],
  occupied: Set<string>,
  baseX: number,
  baseY: number,
  baseZ: number,
  treeHeight: number,
  trunkRadius: number,
  treeType: TreeType,
  rootStyle: RootStyle,
  rng: () => number,
  rootsGrowthOrder: number,
  // Optional water check - stops root growth at water edge
  isWaterPosition?: (x: number, y: number, z: number) => boolean
): void {
  if (rootStyle === 'none') return;

  const directions = treeType === 'original' ? CROSS_DIRS : HEXISH_DIRS;

  for (const dir of directions) {
    generateSingleRoot(
      blocks, occupied,
      baseX, baseY, baseZ,
      treeHeight, trunkRadius,
      dir.dx, dir.dz,
      rootStyle, rng,
      rootsGrowthOrder,
      trunkRadius,
      isWaterPosition
    );
  }
}
