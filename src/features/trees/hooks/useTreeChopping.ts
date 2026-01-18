// Hook for chopping down trees and returning seeds to inventory
// Only the tree owner can chop their tree

import { useCallback, useRef } from 'react';
import { PlantedTree, SeedDefinition } from '../types';
import { deleteTree } from './useLocalGrowth';
import { useToast } from '@/hooks/use-toast';

// Throttle chopping to prevent accidental double-chops
const CHOP_COOLDOWN_MS = 1000;

interface UseTreeChoppingOptions {
  worldId: string | null;
  userId: string | null;
  plantedTrees: PlantedTree[];
  seedDefinitions: SeedDefinition[];
  returnSeed: (seedDefId: string) => Promise<boolean>;
  refreshBlocks: () => void;
}

interface ChopResult {
  success: boolean;
  error?: string;
  seedReturned?: boolean;
}

/**
 * Find which tree a block at the given position belongs to
 * Uses the planted_trees base positions and regenerates blueprint to check
 */
function findTreeAtPosition(
  x: number,
  y: number,
  z: number,
  plantedTrees: PlantedTree[]
): PlantedTree | null {
  // A block belongs to a tree if it's within the tree's potential bounds
  // For efficiency, we check if the block is near any tree's base
  // Trees grow upward and branch outward, so check a reasonable radius
  
  for (const tree of plantedTrees) {
    const dx = Math.abs(x - tree.base_x);
    const dy = y - tree.base_y; // y should be at or above base
    const dz = Math.abs(z - tree.base_z);
    
    // Trees can spread based on tier. Max spread is roughly tier * 2
    const maxSpread = (tree.seed_definition?.tier ?? 5) * 2;
    const maxHeight = (tree.seed_definition?.tier ?? 5) * 10;
    
    if (dx <= maxSpread && dz <= maxSpread && dy >= 0 && dy <= maxHeight) {
      return tree;
    }
  }
  
  return null;
}

/**
 * Play axe chop sound
 */
async function playAxeChopSound(): Promise<void> {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const response = await fetch('/axe_chop.mp3');
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
  } catch (error) {
    console.warn('Failed to play axe chop sound:', error);
  }
}

export function useTreeChopping({
  worldId,
  userId,
  plantedTrees,
  seedDefinitions,
  returnSeed,
  refreshBlocks,
}: UseTreeChoppingOptions) {
  const { toast } = useToast();
  const lastChopTimeRef = useRef(0);
  const isChoppingRef = useRef(false);

  /**
   * Attempt to chop a tree at the given block position
   * Returns success if the tree was owned by the user and successfully chopped
   */
  const chopTreeAtPosition = useCallback(async (
    blockX: number,
    blockY: number,
    blockZ: number
  ): Promise<ChopResult> => {
    if (!worldId || !userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Throttle chopping
    const now = Date.now();
    if (now - lastChopTimeRef.current < CHOP_COOLDOWN_MS) {
      return { success: false, error: 'Please wait before chopping again' };
    }

    if (isChoppingRef.current) {
      return { success: false, error: 'Already chopping' };
    }

    // Find which tree this block belongs to
    const tree = findTreeAtPosition(blockX, blockY, blockZ, plantedTrees);
    
    if (!tree) {
      return { success: false, error: 'No tree found at this position' };
    }

    // Check ownership
    if (tree.planted_by !== userId) {
      toast({
        title: "Not your tree",
        description: "You can only chop down trees you planted",
        variant: "destructive"
      });
      return { success: false, error: 'Not owner' };
    }

    // Get seed definition for this tree
    const seedDef = tree.seed_definition || seedDefinitions.find(s => s.id === tree.seed_definition_id);
    if (!seedDef) {
      return { success: false, error: 'Seed definition not found' };
    }

    isChoppingRef.current = true;
    lastChopTimeRef.current = now;

    try {
      // Play axe chop sound
      await playAxeChopSound();

      // Delete the tree (blocks + planted_trees record)
      const deleteResult = await deleteTree(tree, seedDef);

      if (!deleteResult.success) {
        toast({
          title: "Chop failed",
          description: deleteResult.error || "Failed to chop tree",
          variant: "destructive"
        });
        return { success: false, error: deleteResult.error };
      }

      // Remove blocks from collision grid
      // The deleteTree function removes from DB, but we need to clear local collision
      // This will be handled by the chunk system detecting the deleted blocks

      // Return the seed to inventory
      const seedReturned = await returnSeed(seedDef.id);

      if (seedReturned) {
        toast({
          title: `${seedDef.name || 'Tree'} chopped!`,
          description: `Seed returned to your inventory`,
        });
      } else {
        toast({
          title: `${seedDef.name || 'Tree'} chopped!`,
          description: `${deleteResult.deletedCount} blocks removed`,
        });
      }

      // Trigger a blocks refresh to update the UI
      refreshBlocks();

      return { success: true, seedReturned };
    } catch (error) {
      console.error('[TreeChopping] Error:', error);
      toast({
        title: "Chop failed",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
      return { success: false, error: 'Unexpected error' };
    } finally {
      isChoppingRef.current = false;
    }
  }, [worldId, userId, plantedTrees, seedDefinitions, returnSeed, refreshBlocks, toast]);

  /**
   * Check if a position is on a tree owned by the current user
   */
  const isOwnedTreeAtPosition = useCallback((
    blockX: number,
    blockY: number,
    blockZ: number
  ): boolean => {
    if (!userId) {
      console.log('[TreeChopping] No userId, returning false');
      return false;
    }
    
    console.log(`[TreeChopping] Checking position (${blockX}, ${blockY}, ${blockZ}), userId=${userId}, plantedTrees count=${plantedTrees.length}`);
    
    const tree = findTreeAtPosition(blockX, blockY, blockZ, plantedTrees);
    
    if (tree) {
      console.log(`[TreeChopping] Found tree: id=${tree.id}, planted_by=${tree.planted_by}, isOwner=${tree.planted_by === userId}`);
    } else {
      console.log('[TreeChopping] No tree found at position');
    }
    
    return tree !== null && tree.planted_by === userId;
  }, [userId, plantedTrees]);

  return {
    chopTreeAtPosition,
    isOwnedTreeAtPosition,
  };
}
