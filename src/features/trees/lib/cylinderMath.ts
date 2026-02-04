/**
 * Cylinder Math Helpers
 *
 * Utility functions for generating cylindrical and ring-based voxel structures.
 */

export interface Position {
  x: number;
  y: number;
  z: number;
}

/**
 * Check if a point is on the shell of a cylinder (within tolerance)
 */
export function isOnCylinderShell(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  radius: number,
  tolerance: number = 0.5
): boolean {
  const dx = x - centerX;
  const dz = z - centerZ;
  const dist = Math.sqrt(dx * dx + dz * dz);
  return dist >= radius - tolerance && dist <= radius + tolerance;
}

/**
 * Check if a point is inside a cylinder (including shell)
 */
export function isInsideCylinder(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  radius: number
): boolean {
  const dx = x - centerX;
  const dz = z - centerZ;
  const dist = Math.sqrt(dx * dx + dz * dz);
  return dist <= radius + 0.5;
}

/**
 * Get all voxel positions forming a ring at a specific height
 * Uses 2-block-thick annulus to avoid diagonal gaps that occur with
 * the midpoint circle algorithm at larger radii.
 */
export function getRingBlocks(
  centerX: number,
  y: number,
  centerZ: number,
  radius: number
): Position[] {
  const blocks: Position[] = [];
  const innerRadius = Math.max(0, radius - 1);
  // Use wider margin (0.7 instead of 0.5) to ensure no diagonal gaps at larger radii
  const innerRadiusSq = (innerRadius - 0.7) * (innerRadius - 0.7);
  const outerRadiusSq = (radius + 0.7) * (radius + 0.7);

  const scanRadius = radius + 1;
  for (let dx = -scanRadius; dx <= scanRadius; dx++) {
    for (let dz = -scanRadius; dz <= scanRadius; dz++) {
      const distSq = dx * dx + dz * dz;
      if (distSq >= innerRadiusSq && distSq <= outerRadiusSq) {
        blocks.push({
          x: Math.round(centerX + dx),
          y,
          z: Math.round(centerZ + dz),
        });
      }
    }
  }

  return blocks;
}

/**
 * Get all voxel positions forming a filled disk at a specific height
 */
export function getDiskBlocks(
  centerX: number,
  y: number,
  centerZ: number,
  radius: number
): Position[] {
  const blocks: Position[] = [];
  const radiusSq = (radius + 0.5) * (radius + 0.5);

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const distSq = dx * dx + dz * dz;
      if (distSq <= radiusSq) {
        blocks.push({
          x: Math.round(centerX + dx),
          y,
          z: Math.round(centerZ + dz),
        });
      }
    }
  }

  return blocks;
}

/**
 * Get all voxel positions forming a hollow cylinder shell
 */
export function getCylinderShellBlocks(
  centerX: number,
  baseY: number,
  centerZ: number,
  radius: number,
  height: number
): Position[] {
  const blocks: Position[] = [];

  for (let y = baseY; y < baseY + height; y++) {
    const ringBlocks = getRingBlocks(centerX, y, centerZ, radius);
    blocks.push(...ringBlocks);
  }

  return blocks;
}

/**
 * Get all voxel positions forming a filled cylinder
 */
export function getFilledCylinderBlocks(
  centerX: number,
  baseY: number,
  centerZ: number,
  radius: number,
  height: number
): Position[] {
  const blocks: Position[] = [];

  for (let y = baseY; y < baseY + height; y++) {
    const diskBlocks = getDiskBlocks(centerX, y, centerZ, radius);
    blocks.push(...diskBlocks);
  }

  return blocks;
}

/**
 * Get blocks forming a ring with thickness (annulus)
 */
export function getAnnulusBlocks(
  centerX: number,
  y: number,
  centerZ: number,
  innerRadius: number,
  outerRadius: number
): Position[] {
  const blocks: Position[] = [];
  const innerRadiusSq = (innerRadius - 0.5) * (innerRadius - 0.5);
  const outerRadiusSq = (outerRadius + 0.5) * (outerRadius + 0.5);

  for (let dx = -outerRadius; dx <= outerRadius; dx++) {
    for (let dz = -outerRadius; dz <= outerRadius; dz++) {
      const distSq = dx * dx + dz * dz;
      if (distSq >= innerRadiusSq && distSq <= outerRadiusSq) {
        blocks.push({
          x: Math.round(centerX + dx),
          y,
          z: Math.round(centerZ + dz),
        });
      }
    }
  }

  return blocks;
}

/**
 * Get spiral staircase positions
 * Generates a spiral that hugs the inner wall of a cylinder
 */
export function getSpiralStairBlocks(
  centerX: number,
  centerZ: number,
  innerRadius: number,
  outerRadius: number,
  startY: number,
  endY: number,
  blocksPerRotation: number = 16
): Position[] {
  const blocks: Position[] = [];
  const height = endY - startY;
  const totalBlocks = Math.floor(height * blocksPerRotation / (2 * Math.PI));
  const seen = new Set<string>();

  for (let i = 0; i < totalBlocks; i++) {
    // Calculate angle (radians)
    const angle = (i / blocksPerRotation) * 2 * Math.PI;
    const y = startY + Math.floor(i * height / totalBlocks);

    // Calculate position on the ring
    const avgRadius = (innerRadius + outerRadius) / 2;

    // Generate stair blocks (2 wide radially)
    for (let r = innerRadius; r <= outerRadius; r++) {
      const x = Math.round(centerX + r * Math.cos(angle));
      const z = Math.round(centerZ + r * Math.sin(angle));
      const key = `${x},${y},${z}`;

      if (!seen.has(key)) {
        seen.add(key);
        blocks.push({ x, y, z });
      }
    }
  }

  return blocks;
}

/**
 * Get positions around a circle at given intervals
 * Useful for placing columns
 */
export function getCirclePositions(
  centerX: number,
  centerZ: number,
  radius: number,
  spacing: number
): { x: number; z: number }[] {
  const positions: { x: number; z: number }[] = [];
  const circumference = 2 * Math.PI * radius;
  const numPositions = Math.floor(circumference / spacing);

  for (let i = 0; i < numPositions; i++) {
    const angle = (i / numPositions) * 2 * Math.PI;
    positions.push({
      x: Math.round(centerX + radius * Math.cos(angle)),
      z: Math.round(centerZ + radius * Math.sin(angle)),
    });
  }

  return positions;
}

/**
 * Check if a position is within a door opening
 */
export function isInDoorOpening(
  x: number,
  y: number,
  z: number,
  doorCenterX: number,
  doorBaseY: number,
  doorCenterZ: number,
  doorWidth: number,
  doorHeight: number,
  doorDirection: 'x' | 'z'
): boolean {
  if (y < doorBaseY || y >= doorBaseY + doorHeight) {
    return false;
  }

  const halfWidth = Math.floor(doorWidth / 2);

  if (doorDirection === 'z') {
    // Door opens in Z direction
    return Math.abs(x - doorCenterX) <= halfWidth && z === doorCenterZ;
  } else {
    // Door opens in X direction
    return Math.abs(z - doorCenterZ) <= halfWidth && x === doorCenterX;
  }
}
