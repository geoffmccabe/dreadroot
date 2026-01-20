// Tree Block Loader - Fetches fully-grown tree blocks from DB and injects into chunk loader
// This runs ONCE on world initialization to make pre-existing trees visible

import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlacedBlock } from '@/types/blocks';
import { TREE_CONFIG } from '../constants';
import { initLogStep } from '@/contexts/InitializationContext';

// Type for addBlocksBatch from chunk loader
type AddBlocksBatchFn = (blocks: PlacedBlock[]) => void;

interface UseTreeBlockLoaderOptions {
  worldId: string | null;
  addBlocksBatch: AddBlocksBatchFn | null;
}

/**
 * Hook to load pre-existing tree blocks from the database on world initialization.
 * Tree blocks are stored in `tree_blocks` table (separate from `placed_blocks`),
 * so they need to be fetched and injected into the chunk loader separately.
 */
export function useTreeBlockLoader({ worldId, addBlocksBatch }: UseTreeBlockLoaderOptions) {
  // Track if we've loaded trees for this world
  const loadedWorldRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  /**
   * Load all tree blocks for fully-grown trees and inject them into the chunk loader.
   * Should be called AFTER initializeForWorld completes.
   */
  const loadTreeBlocks = useCallback(async () => {
    if (!worldId || !addBlocksBatch || !TREE_CONFIG.ENABLED) {
      console.log('[TreeBlockLoader] Skipping: missing worldId, addBlocksBatch, or trees disabled');
      initLogStep('useTreeBlockLoader.ts', 'Trees disabled or missing config, skipping');
      return;
    }

    // Skip if already loaded for this world
    if (loadedWorldRef.current === worldId) {
      console.log('[TreeBlockLoader] Already loaded for this world, skipping');
      return;
    }

    // Prevent concurrent loads
    if (isLoadingRef.current) {
      console.log('[TreeBlockLoader] Load already in progress, skipping');
      return;
    }

    isLoadingRef.current = true;
    console.log('[TreeBlockLoader] Loading tree blocks for world:', worldId);
    initLogStep('useTreeBlockLoader.ts', 'Fetching tree blocks from database...');

    try {
      // Fetch all tree blocks for fully-grown trees, joined with seed definitions for textures
      // We need: position, block_type, texture from seed_definition
      // Use explicit FK name to avoid ambiguity (there are 2 FKs between tree_blocks and planted_trees)
      const { data: treeBlocks, error } = await supabase
        .from('tree_blocks')
        .select(`
          id,
          tree_id,
          world_id,
          position_x,
          position_y,
          position_z,
          block_type,
          growth_order,
          created_at,
          planted_trees!fk_tree_blocks_planted_trees (
            id,
            is_fully_grown,
            seed_definition_id,
            seed_definitions (
              trunk_texture_url,
              branch_texture_url
            )
          )
        `)
        .eq('world_id', worldId)
        .eq('planted_trees.is_fully_grown', true);

      if (error) {
        console.error('[TreeBlockLoader] Error fetching tree blocks:', error);
        initLogStep('useTreeBlockLoader.ts', `Error: ${error.message}`);
        return;
      }

      if (!treeBlocks || treeBlocks.length === 0) {
        console.log('[TreeBlockLoader] No tree blocks found for world');
        initLogStep('useTreeBlockLoader.ts', 'No tree blocks found', 0);
        loadedWorldRef.current = worldId;
        return;
      }

      console.log(`[TreeBlockLoader] Found ${treeBlocks.length} tree blocks to load`);
      initLogStep('useTreeBlockLoader.ts', 'Tree blocks fetched', treeBlocks.length);

      // Convert tree_blocks to PlacedBlock format
      const placedBlocks: PlacedBlock[] = treeBlocks.map((tb: any) => {
        // Determine texture URL based on block type
        const seedDef = tb.planted_trees?.seed_definitions;
        let textureUrl: string | null = null;
        
        if (tb.block_type === 'trunk') {
          textureUrl = seedDef?.trunk_texture_url || null;
        } else if (['branch', 'leaf', 'spike', 'nob', 'cross', 'shroom', 'shroom_stem', 'shroom_cap'].includes(tb.block_type)) {
          textureUrl = seedDef?.branch_texture_url || seedDef?.trunk_texture_url || null;
        }

        return {
          id: tb.id,
          user_id: null, // Tree blocks don't have a user_id in placed_blocks format
          position_x: tb.position_x,
          position_y: tb.position_y,
          position_z: tb.position_z,
          block_type: tb.block_type,
          created_at: tb.created_at,
          updated_at: tb.created_at,
          texture_url: textureUrl,
          // Branch depth could be derived from growth_order, but we default to -1 for trunk
          branch_depth: tb.block_type === 'trunk' ? -1 : 0,
        };
      });

      // Inject all tree blocks into the chunk loader in one batch
      console.log(`[TreeBlockLoader] Injecting ${placedBlocks.length} tree blocks into chunk loader`);
      addBlocksBatch(placedBlocks);
      initLogStep('useTreeBlockLoader.ts', 'Tree blocks injected into chunk loader', placedBlocks.length);

      loadedWorldRef.current = worldId;
      console.log('[TreeBlockLoader] Tree blocks loaded successfully');
    } catch (err) {
      console.error('[TreeBlockLoader] Unexpected error:', err);
      initLogStep('useTreeBlockLoader.ts', `Unexpected error: ${err}`);
    } finally {
      isLoadingRef.current = false;
    }
  }, [worldId, addBlocksBatch]);

  /**
   * Reset the loader state (call when world changes)
   */
  const reset = useCallback(() => {
    loadedWorldRef.current = null;
    isLoadingRef.current = false;
  }, []);

  return {
    loadTreeBlocks,
    reset,
  };
}
