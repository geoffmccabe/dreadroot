// Vault anchor: AABB the player must be inside to trigger the prompt
// and open the vault. Derived from FORTRESS_DIMENSIONS so it follows
// any future fortress resize. The "back wall" is the one directly
// opposite the front door — the wall the player walks toward after
// entering the courtyard.
//
// FortressCollision back-wall collider:
//   x: [-cliffW/2, +cliffW/2]
//   y: [0, cliffH]
//   z: [frontZ - courtyardDepth - frontT - 1,
//       frontZ - courtyardDepth - frontT + 1]
// We trigger anywhere within 2m of the inside face (z = frontZ -
// courtyardDepth - frontT + 1) and across the full wall width / height.
//
// IMPORTANT: do NOT destructure FORTRESS_DIMENSIONS at module top-
// level. The first vault build did, and it threw a temporal-dead-zone
// "Cannot access FORTRESS_DIMENSIONS before initialization" at app
// start due to circular module-load ordering with the rest of the
// fortress code. Reading the value inside a function avoids that
// entire class of bug.

import { FORTRESS_DIMENSIONS } from '@/components/fortress/FortressCollision';

export interface VaultTriggerAABB {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

// The whole fortress interior — from the back wall up to the front door, across
// the full width + height. The vault prompt + V keybind now work ANYWHERE inside
// the fortress, not only in the old 2m back-wall strip.
export function getVaultTriggerAABB(): VaultTriggerAABB {
  const { cliffW, cliffH, frontT, courtyardDepth, frontZ } = FORTRESS_DIMENSIONS;
  return {
    minX: -cliffW / 2,
    maxX:  cliffW / 2,
    minY: 0,
    maxY: cliffH,
    minZ: frontZ - courtyardDepth - frontT, // back wall
    maxZ: frontZ,                           // front door
  };
}

export function isInVaultTriggerZone(x: number, y: number, z: number): boolean {
  const a = getVaultTriggerAABB();
  return (
    x >= a.minX && x <= a.maxX &&
    y >= a.minY && y <= a.maxY &&
    z >= a.minZ && z <= a.maxZ
  );
}
