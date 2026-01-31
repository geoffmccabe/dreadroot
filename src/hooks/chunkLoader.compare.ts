import { PlacedBlock } from '@/types/blocks';

/**
 * Check if two block arrays are equivalent (same blocks at same positions with same properties)
 * Used to skip unnecessary re-renders when refetch returns identical data
 */
export const blocksAreEquivalent = (a: PlacedBlock[], b: PlacedBlock[]): boolean => {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  
  // Create position-keyed map for O(1) lookup
  const mapA = new Map<string, PlacedBlock>();
  for (const block of a) {
    const key = `${block.position_x},${block.position_y},${block.position_z}`;
    mapA.set(key, block);
  }
  
  for (const blockB of b) {
    const key = `${blockB.position_x},${blockB.position_y},${blockB.position_z}`;
    const blockA = mapA.get(key);
    if (!blockA) return false;
    
    // Compare visual properties that affect rendering
    if (blockA.block_type !== blockB.block_type) return false;
    if (blockA.texture_url !== blockB.texture_url) return false;
  }
  
  return true;
};
