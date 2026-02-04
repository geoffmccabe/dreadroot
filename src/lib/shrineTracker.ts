/**
 * Shrine Position Tracker
 *
 * Tracks shrine block positions for proximity checks.
 * Supports two modes:
 * 1. Pre-registered shrines with known base positions
 * 2. Block-based detection using loaded shrine blocks
 *
 * Used by:
 * - Fruit Forging: Player must be inside a shrine to forge
 * - Purple glow: Shrine interior glows when player is near entrance
 * - Future features: Interior wall triggers
 */

import * as THREE from 'three';

export interface ShrineEntry {
  baseX: number;
  baseY: number;
  baseZ: number;
  doorDir: 'x' | 'z'; // Which axis the doors face (perpendicular to branch)
  // Interior wall centers (for future trigger features)
  wall1Center: { x: number; y: number; z: number };
  wall2Center: { x: number; y: number; z: number };
}

export interface ShrineBlockPosition {
  x: number;
  y: number;
  z: number;
}

class ShrineTrackerService {
  private shrines: Map<string, ShrineEntry> = new Map();
  // Block-based tracking: individual shrine block positions
  private shrineBlocks: Map<string, ShrineBlockPosition> = new Map();

  /**
   * Generate unique key for a position
   */
  private getKey(x: number, y: number, z: number): string {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  /**
   * Register an individual shrine block (used when loading blocks)
   */
  registerShrineBlock(x: number, y: number, z: number): void {
    const key = this.getKey(x, y, z);
    this.shrineBlocks.set(key, { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
  }

  /**
   * Remove a shrine block
   */
  unregisterShrineBlock(x: number, y: number, z: number): void {
    const key = this.getKey(x, y, z);
    this.shrineBlocks.delete(key);
  }

  /**
   * Bulk register shrine blocks (more efficient for loading)
   */
  registerShrineBlocks(positions: Array<{ x: number; y: number; z: number }>): void {
    for (const pos of positions) {
      this.registerShrineBlock(pos.x, pos.y, pos.z);
    }
  }

  /**
   * Clear all shrine blocks (on world change)
   */
  clearBlocks(): void {
    this.shrineBlocks.clear();
  }

  /**
   * Check if a position has a shrine block nearby (within given radius)
   * Uses block-based detection
   */
  hasShrineBLockNearby(x: number, y: number, z: number, radius: number = 3): boolean {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const key = this.getKey(fx + dx, fy + dy, fz + dz);
          if (this.shrineBlocks.has(key)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Count shrine blocks around a position (to determine if inside a shrine)
   * A player is "inside" if surrounded by shrine blocks on multiple sides
   */
  countSurroundingShrineBlocks(x: number, y: number, z: number): number {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    let count = 0;

    // Check a 5x5x5 area around player
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 4; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const key = this.getKey(fx + dx, fy + dy, fz + dz);
          if (this.shrineBlocks.has(key)) {
            count++;
          }
        }
      }
    }
    return count;
  }

  /**
   * Get count of registered shrine blocks
   */
  get blockCount(): number {
    return this.shrineBlocks.size;
  }

  /**
   * Register a shrine at a position
   * @param x Base X position (center of shrine)
   * @param y Base Y position (floor level)
   * @param z Base Z position (center of shrine)
   * @param doorDir Which axis the doors face ('x' = doors at +/-X, 'z' = doors at +/-Z)
   */
  registerShrine(x: number, y: number, z: number, doorDir: 'x' | 'z'): void {
    const key = this.getKey(x, y, z);

    // Calculate interior wall centers
    // Walls are perpendicular to doors, at the edges of the 5x5 base
    // Interior is 3x3, so walls are at +/-2 from center on the perpendicular axis
    let wall1Center: { x: number; y: number; z: number };
    let wall2Center: { x: number; y: number; z: number };

    if (doorDir === 'x') {
      // Doors face +/-X, walls are at +/-Z edges
      wall1Center = { x, y: y + 2, z: z - 2 }; // Wall at -Z
      wall2Center = { x, y: y + 2, z: z + 2 }; // Wall at +Z
    } else {
      // Doors face +/-Z, walls are at +/-X edges
      wall1Center = { x: x - 2, y: y + 2, z }; // Wall at -X
      wall2Center = { x: x + 2, y: y + 2, z }; // Wall at +X
    }

    this.shrines.set(key, {
      baseX: x,
      baseY: y,
      baseZ: z,
      doorDir,
      wall1Center,
      wall2Center,
    });
  }

  /**
   * Remove a shrine (when tree is chopped)
   */
  unregisterShrine(x: number, y: number, z: number): void {
    const key = this.getKey(x, y, z);
    this.shrines.delete(key);
  }

  /**
   * Check if a position is inside any shrine's interior
   * Uses both pre-registered shrines and block-based detection
   */
  isInsideShrine(x: number, y: number, z: number): boolean {
    // First check pre-registered shrines (more accurate)
    for (const shrine of this.shrines.values()) {
      const dx = x - shrine.baseX;
      const dy = y - shrine.baseY;
      const dz = z - shrine.baseZ;

      // Check if within hollow interior (3x3 center, 6 blocks tall)
      if (
        Math.abs(dx) <= 1.5 &&
        Math.abs(dz) <= 1.5 &&
        dy >= 0 &&
        dy <= 5
      ) {
        return true;
      }
    }

    // Fall back to block-based detection
    // Player is "inside" if surrounded by enough shrine blocks
    // A shrine base is 5x5, hollow interior is 3x3, so if we detect
    // 10+ shrine blocks within 3 blocks, player is likely inside
    const surroundingBlocks = this.countSurroundingShrineBlocks(x, y, z);
    if (surroundingBlocks >= 10) {
      return true;
    }

    return false;
  }

  /**
   * Check if player is near either entrance of a shrine (for glow effect)
   * Entrances are the 2-wide x 3-tall door openings
   */
  isNearShrineEntrance(x: number, y: number, z: number, maxDistance: number = 5): ShrineEntry | null {
    for (const shrine of this.shrines.values()) {
      // Calculate entrance positions based on door direction
      let entrance1: { x: number; z: number };
      let entrance2: { x: number; z: number };

      if (shrine.doorDir === 'x') {
        // Doors face +/-X (at z edges)
        entrance1 = { x: shrine.baseX, z: shrine.baseZ - 2.5 };
        entrance2 = { x: shrine.baseX, z: shrine.baseZ + 2.5 };
      } else {
        // Doors face +/-Z (at x edges)
        entrance1 = { x: shrine.baseX - 2.5, z: shrine.baseZ };
        entrance2 = { x: shrine.baseX + 2.5, z: shrine.baseZ };
      }

      // Check distance to either entrance (2D distance, ignore Y for entrance proximity)
      const dist1 = Math.sqrt(
        (x - entrance1.x) ** 2 + (z - entrance1.z) ** 2
      );
      const dist2 = Math.sqrt(
        (x - entrance2.x) ** 2 + (z - entrance2.z) ** 2
      );

      // Also check Y is within reasonable range of shrine height
      const dy = y - shrine.baseY;
      if (dy >= -1 && dy <= 6) {
        if (dist1 <= maxDistance || dist2 <= maxDistance) {
          return shrine;
        }
      }
    }
    return null;
  }

  /**
   * Check if player is near an interior wall (for future triggers)
   * @returns Object with near status and which wall (1 or 2), or null if not near
   */
  isNearInteriorWall(
    x: number,
    y: number,
    z: number,
    maxDistance: number = 3
  ): { shrine: ShrineEntry; wall: 1 | 2 } | null {
    for (const shrine of this.shrines.values()) {
      const dist1 = Math.sqrt(
        (x - shrine.wall1Center.x) ** 2 +
        (y - shrine.wall1Center.y) ** 2 +
        (z - shrine.wall1Center.z) ** 2
      );
      const dist2 = Math.sqrt(
        (x - shrine.wall2Center.x) ** 2 +
        (y - shrine.wall2Center.y) ** 2 +
        (z - shrine.wall2Center.z) ** 2
      );

      if (dist1 <= maxDistance) {
        return { shrine, wall: 1 };
      }
      if (dist2 <= maxDistance) {
        return { shrine, wall: 2 };
      }
    }
    return null;
  }

  /**
   * Get all shrines within a range of a position
   */
  getShrinesInRange(position: THREE.Vector3, radius: number): ShrineEntry[] {
    const result: ShrineEntry[] = [];
    const radiusSq = radius * radius;

    for (const shrine of this.shrines.values()) {
      const dx = position.x - shrine.baseX;
      const dy = position.y - shrine.baseY;
      const dz = position.z - shrine.baseZ;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= radiusSq) {
        result.push(shrine);
      }
    }
    return result;
  }

  /**
   * Get all registered shrines
   */
  getAllShrines(): ShrineEntry[] {
    return Array.from(this.shrines.values());
  }

  /**
   * Get shrine count
   */
  get count(): number {
    return this.shrines.size;
  }

  /**
   * Clear all shrines (on world change)
   */
  clear(): void {
    this.shrines.clear();
  }
}

// Export singleton instance
export const shrineTracker = new ShrineTrackerService();
