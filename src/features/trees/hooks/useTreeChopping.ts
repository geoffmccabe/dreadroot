// Hook for chopping down trees and returning seeds to inventory
// Only the tree owner can chop their tree
// NEW ARCHITECTURE: Uses delete_tree_with_blocks RPC with blueprint positions

import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree, SeedDefinition, TreeBlueprint, TreeGrowthOptions } from '../types';
import { deleteTree } from './useLocalGrowth';
import { useToast } from '@/hooks/use-toast';
import { blockDB } from '@/hooks/useIndexedDB';
import { collisionGrid } from '@/lib/spatialHashGrid';
import { generateTreeBlueprint } from '../lib/treeGrowth';

// Throttle chopping to prevent accidental double-chops
const CHOP_COOLDOWN_MS = 1000;
const CHUNK_SIZE = 16;

interface UseTreeChoppingOptions {
  worldId: string | null;
  userId: string | null;
  plantedTrees: PlantedTree[];
  seedDefinitions: SeedDefinition[];
  returnSeed: (seedDefId: string) => Promise<boolean>;
  refetchChunk: (chunkX: number, chunkZ: number) => Promise<void>;
  stopGrowing?: (treeId: string) => void;
  removeBlocksByPositions?: (positions: Array<{ x: number; y: number; z: number }>) => number;
}

interface ChopResult {
  success: boolean;
  error?: string;
  seedReturned?: boolean;
}

/**
 * Build options object from seed definition for tree generation
 */
function buildGrowthOptions(seedDef: SeedDefinition): TreeGrowthOptions {
  return {
    lowBranchHeight: seedDef.low_branch_height ?? 2,
    spikeChance: seedDef.spike_chance ?? 0,
    spikeLength: seedDef.spike_length ?? 3,
    nobChance: seedDef.nob_chance ?? 0,
    nobSize: seedDef.nob_size ?? 1,
    crossChance: seedDef.cross_chance ?? 0,
    crossLength: seedDef.cross_length ?? 3,
    shroomChance: seedDef.shroom_chance ?? 0,
    shroomLength: seedDef.shroom_length ?? 5,
    shroomCapDiameter: seedDef.shroom_cap_diameter ?? 3,
    symmetry: seedDef.symmetry ?? 'none',
  };
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
  console.log(`[TreeChopping] findTreeAtPosition(${x}, ${y}, ${z}) - checking ${plantedTrees.length} trees`);
  
  // A block belongs to a tree if it's within the tree's potential bounds
  for (const tree of plantedTrees) {
    const dx = Math.abs(x - tree.base_x);
    const dy = y - tree.base_y; // y should be at or above base
    const dz = Math.abs(z - tree.base_z);
    
    // Trees can spread based on tier. Max spread is roughly tier * 2
    const maxSpread = (tree.seed_definition?.tier ?? 5) * 2;
    const maxHeight = (tree.seed_definition?.tier ?? 5) * 10;
    
    const inBounds = dx <= maxSpread && dz <= maxSpread && dy >= 0 && dy <= maxHeight;
    console.log(`[TreeChopping] Tree at (${tree.base_x}, ${tree.base_y}, ${tree.base_z}) tier=${tree.seed_definition?.tier}, dx=${dx}, dz=${dz}, dy=${dy}, maxSpread=${maxSpread}, maxHeight=${maxHeight}, inBounds=${inBounds}`);
    
    if (inBounds) {
      return tree;
    }
  }
  
  console.log(`[TreeChopping] No tree found at position`);
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

/**
 * Get block positions for a tree - tries blueprint table first, then regenerates
 */
async function getTreeBlockPositions(
  tree: PlantedTree,
  seedDef: SeedDefinition
): Promise<{ x: number; y: number; z: number }[]> {
  // First try to get blueprint from tree_blueprints table
  const { data: blueprintData } = await supabase
    .from('tree_blueprints')
    .select('blueprint_data')
    .eq('planted_tree_id', tree.id)
    .maybeSingle();

  if (blueprintData?.blueprint_data) {
    const bp = blueprintData.blueprint_data as { blocks: Array<{ x: number; y: number; z: number }> };
    return bp.blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
  }

  // Fallback: regenerate blueprint
  const blueprint = generateTreeBlueprint(
    tree.base_x,
    tree.base_y,
    tree.base_z,
    seedDef.tier,
    seedDef.width_factor,
    seedDef.branching_factor,
    tree.growth_seed,
    buildGrowthOptions(seedDef)
  );
  
  return blueprint.blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
}

export function useTreeChopping({
  worldId,
  userId,
  plantedTrees,
  seedDefinitions,
  returnSeed,
  refetchChunk,
  stopGrowing,
  removeBlocksByPositions,
}: UseTreeChoppingOptions) {
  const { toast } = useToast();
  const lastChopTimeRef = useRef(0);
  const isChoppingRef = useRef(false);

  /**
   * Attempt to chop a tree at the given block position
   * Uses delete_tree_with_blocks RPC for ownership-verified deletion
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
      // CRITICAL: Stop local growth FIRST to prevent new blocks from being placed
      stopGrowing?.(tree.id);

      // Play axe chop sound
      await playAxeChopSound();

      // Delete the tree using the new architecture (RPC with ownership check)
      const deleteResult = await deleteTree(tree, seedDef, removeBlocksByPositions);

      if (!deleteResult.success) {
        toast({
          title: "Chop failed",
          description: deleteResult.error || "Failed to chop tree",
          variant: "destructive"
        });
        return { success: false, error: deleteResult.error };
      }

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

      // Clear IndexedDB cache for the affected chunk
      const chunkX = Math.floor(tree.base_x / CHUNK_SIZE);
      const chunkZ = Math.floor(tree.base_z / CHUNK_SIZE);
      
      if (worldId) {
        try {
          await blockDB.clearCachedChunksForWorld(worldId);
          console.log(`[TreeChopping] Cleared IndexedDB cache for world ${worldId}`);
        } catch (cacheError) {
          console.warn('[TreeChopping] Failed to clear IndexedDB cache:', cacheError);
        }
      }

      // Refresh the affected chunk from the database
      await refetchChunk(chunkX, chunkZ);
      
      // Also refetch adjacent chunks if tree could have spanned across chunk boundaries
      const adjacentOffsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dz] of adjacentOffsets) {
        await refetchChunk(chunkX + dx, chunkZ + dz);
      }

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
  }, [worldId, userId, plantedTrees, seedDefinitions, returnSeed, refetchChunk, toast, stopGrowing, removeBlocksByPositions]);

  /**
   * Check if a position is on a tree owned by the current user
   */
  const isOwnedTreeAtPosition = useCallback((
    blockX: number,
    blockY: number,
    blockZ: number
  ): boolean => {
    if (!userId) {
      return false;
    }
    
    const tree = findTreeAtPosition(blockX, blockY, blockZ, plantedTrees);
    return tree !== null && tree.planted_by === userId;
  }, [userId, plantedTrees]);

  return {
    chopTreeAtPosition,
    isOwnedTreeAtPosition,
  };
}
