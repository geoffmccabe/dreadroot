/**
 * useAtlasSync Hook
 *
 * Syncs texture definitions from database to the atlas.
 * Handles:
 * - Initial population of atlas with all textures
 * - Incremental updates when definitions change
 * - Automatic save to IndexedDB after updates
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { atlasManager } from '@/lib/atlasManager';
import {
  getTreeTextureId,
  getFungalTreeTextureId,
  calculateFungalTreeSlotIndex,
  getShwarmTextureId,
  getShombieTextureId,
  getShnakeTextureId,
  getWalapaTextureId,
  getBlockTextureId,
  getGlobalTextureId,
} from '@/lib/atlasLookup';
import { getGlobalAtlasTexture, incrementAtlasVersion } from '@/hooks/useTextureAtlas';
import { initLogStartStep, initLogFinishStep, initLogStep } from '@/contexts/InitializationContext';

interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * Hook to sync all texture definitions to the atlas
 */
export function useAtlasSync(options?: {
  enabled?: boolean;
  onSyncComplete?: (result: SyncResult) => void;
}) {
  const { enabled = true, onSyncComplete } = options || {};
  const syncInProgressRef = useRef(false);
  const hasSyncedRef = useRef(false);

  // Fetch all definitions in parallel
  const { data: seedDefinitions, isLoading: loadingSeeds } = useQuery({
    queryKey: ['atlas-seed-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seed_definitions')
        .select('*')
        .order('tier');
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: shwarmDefinitions, isLoading: loadingShwarms } = useQuery({
    queryKey: ['atlas-shwarm-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shwarm_definitions')
        .select('tier, texture_url')
        .order('tier');
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: shombieDefinitions, isLoading: loadingShombies } = useQuery({
    queryKey: ['atlas-shombie-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shombie_definitions')
        .select('tier, texture_url')
        .order('tier');
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: shnakeDefinitions, isLoading: loadingShnakes } = useQuery({
    queryKey: ['atlas-shnake-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shnake_definitions')
        .select('tier, head_texture_url, body_texture_url, face_texture_url')
        .order('tier');
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: walapaDefinitions, isLoading: loadingWalapas } = useQuery({
    queryKey: ['atlas-walapa-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('walapa_definitions')
        .select('tier, body_texture_url, belly_texture_url, eyes_texture_url')
        .order('tier');
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const { data: blockTypes, isLoading: loadingBlocks } = useQuery({
    queryKey: ['atlas-block-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('block_types')
        .select('name, texture_url');
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = loadingSeeds || loadingShwarms || loadingShombies || loadingShnakes || loadingWalapas || loadingBlocks;

  // Sync all definitions to atlas
  const syncToAtlas = useCallback(async (): Promise<SyncResult> => {
    if (syncInProgressRef.current) {
      return { added: 0, updated: 0, unchanged: 0 };
    }

    syncInProgressRef.current = true;
    const result: SyncResult = { added: 0, updated: 0, unchanged: 0 };

    try {
      await atlasManager.initialize();

      const stepId = initLogStartStep('useAtlasSync.ts', 'Syncing textures to atlas...');

      // Build batch of all texture specs for parallel loading
      const specs: Array<{
        textureId: string;
        category: string;
        sourceUrl: string | null;
        slotIndex?: number;
      }> = [];

      // Tree textures (30 tiers × 3 types) with deterministic slots
      if (seedDefinitions) {
        for (let tier = 1; tier <= 30; tier++) {
          const def = seedDefinitions.find(d => d.tier === tier);
          const baseSlot = (tier - 1) * 3;
          specs.push({ textureId: getTreeTextureId(tier, 'trunk'), category: 'tree', sourceUrl: def?.trunk_texture_url || null, slotIndex: baseSlot });
          specs.push({ textureId: getTreeTextureId(tier, 'branch'), category: 'tree', sourceUrl: def?.branch_texture_url || def?.trunk_texture_url || null, slotIndex: baseSlot + 1 });
          specs.push({ textureId: getTreeTextureId(tier, 'fruit'), category: 'tree', sourceUrl: def?.fruit_texture_url || def?.trunk_texture_url || null, slotIndex: baseSlot + 2 });
        }
      }

      // Fungal tree textures (30 tiers × 3 types) with deterministic slots
      // Always allocate slots even when URLs are null — otherwise blocks render black
      if (seedDefinitions) {
        for (const def of seedDefinitions) {
          const d = def as any;
          if (d.tree_type === 'fungal' || d.fungal_stem_texture_url || d.fungal_cap_top_texture_url || d.fungal_cap_underside_texture_url) {
            const stemSlot = calculateFungalTreeSlotIndex(def.tier, 'stem');
            const capTopSlot = calculateFungalTreeSlotIndex(def.tier, 'cap_top');
            const capUnderSlot = calculateFungalTreeSlotIndex(def.tier, 'cap_underside');
            specs.push({ textureId: getFungalTreeTextureId(def.tier, 'stem'), category: 'fungal_tree', sourceUrl: d.fungal_stem_texture_url || d.trunk_texture_url || null, slotIndex: stemSlot });
            specs.push({ textureId: getFungalTreeTextureId(def.tier, 'cap_top'), category: 'fungal_tree', sourceUrl: d.fungal_cap_top_texture_url || d.trunk_texture_url || null, slotIndex: capTopSlot });
            specs.push({ textureId: getFungalTreeTextureId(def.tier, 'cap_underside'), category: 'fungal_tree', sourceUrl: d.fungal_cap_underside_texture_url || d.trunk_texture_url || null, slotIndex: capUnderSlot });
          }
        }
      }

      // Shwarm textures
      if (shwarmDefinitions) {
        for (const def of shwarmDefinitions) {
          specs.push({ textureId: getShwarmTextureId(def.tier), category: 'shwarm', sourceUrl: def.texture_url || null });
        }
      }

      // Shombie textures
      if (shombieDefinitions) {
        for (const def of shombieDefinitions) {
          specs.push({ textureId: getShombieTextureId(def.tier), category: 'shombie', sourceUrl: def.texture_url || null });
        }
      }

      // Shnake textures (3 parts each)
      if (shnakeDefinitions) {
        for (const def of shnakeDefinitions) {
          specs.push({ textureId: getShnakeTextureId(def.tier, 'head'), category: 'shnake', sourceUrl: def.head_texture_url || null });
          specs.push({ textureId: getShnakeTextureId(def.tier, 'body'), category: 'shnake', sourceUrl: def.body_texture_url || null });
          specs.push({ textureId: getShnakeTextureId(def.tier, 'face'), category: 'shnake', sourceUrl: def.face_texture_url || null });
        }
      }

      // Walapa textures (3 parts each)
      if (walapaDefinitions) {
        for (const def of walapaDefinitions) {
          specs.push({ textureId: getWalapaTextureId(def.tier, 'body'), category: 'walapa', sourceUrl: def.body_texture_url || null });
          specs.push({ textureId: getWalapaTextureId(def.tier, 'belly'), category: 'walapa', sourceUrl: def.belly_texture_url || null });
          specs.push({ textureId: getWalapaTextureId(def.tier, 'eyes'), category: 'walapa', sourceUrl: def.eyes_texture_url || null });
        }
      }

      // Block textures
      if (blockTypes) {
        for (const block of blockTypes) {
          if (block.texture_url) {
            specs.push({ textureId: getBlockTextureId(block.name), category: 'block', sourceUrl: block.texture_url });
          }
        }
      }

      // Global textures
      specs.push({ textureId: getGlobalTextureId('coin'), category: 'global', sourceUrl: '/waterfall_coin.png' });
      specs.push({ textureId: getGlobalTextureId('cliff'), category: 'global', sourceUrl: '/cliff_texture_seamless.webp' });
      specs.push({ textureId: getGlobalTextureId('grass'), category: 'global', sourceUrl: '/grass_texture_seamless.webp' });

      // Batch load all images in parallel and draw to atlas
      const processed = await atlasManager.batchSetTextures(specs);
      initLogStep('useAtlasSync.ts', 'All textures synced (parallel)', processed);

      // Save to IndexedDB
      await atlasManager.save();

      // Update THREE.js texture to reflect canvas changes
      const atlasTexture = getGlobalAtlasTexture();
      if (atlasTexture) {
        const canvas = atlasManager.getCanvas();
        if (canvas) {
          atlasTexture.image = canvas;
          atlasTexture.needsUpdate = true;
          // Increment version to trigger UV offset recalculation in renderers
          incrementAtlasVersion();
        }
      }

      const stats = atlasManager.getStats();
      if (stepId) initLogFinishStep(stepId, stats.usedSlots);

      console.log(`[AtlasSync] Sync complete: ${stats.usedSlots} slots used`, stats.byCategory);

      return result;
    } finally {
      syncInProgressRef.current = false;
    }
  }, [seedDefinitions, shwarmDefinitions, shombieDefinitions, shnakeDefinitions, walapaDefinitions, blockTypes]);

  // Auto-sync when all definitions are loaded
  useEffect(() => {
    if (!enabled || isLoading || hasSyncedRef.current) return;

    // All definitions loaded, sync to atlas
    syncToAtlas().then(result => {
      hasSyncedRef.current = true;
      onSyncComplete?.(result);
    });
  }, [enabled, isLoading, syncToAtlas, onSyncComplete]);

  return {
    isLoading,
    isSynced: hasSyncedRef.current,
    syncToAtlas,
    definitions: {
      seeds: seedDefinitions,
      shwarms: shwarmDefinitions,
      shombies: shombieDefinitions,
      shnakes: shnakeDefinitions,
      walapas: walapaDefinitions,
      blocks: blockTypes,
    },
  };
}

/**
 * Update a single texture in the atlas (for admin panel use)
 */
export async function updateAtlasTexture(
  category: 'tree' | 'shwarm' | 'shombie' | 'shnake' | 'walapa' | 'block' | 'global',
  textureId: string,
  newUrl: string | null
): Promise<boolean> {
  try {
    await atlasManager.initialize();
    const slotIndex = await atlasManager.setTexture(textureId, category, newUrl);

    if (slotIndex !== null) {
      await atlasManager.save();
      console.log(`[AtlasSync] Updated texture ${textureId} in slot ${slotIndex}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`[AtlasSync] Failed to update texture ${textureId}:`, error);
    return false;
  }
}

/**
 * Remove a texture from the atlas (for admin panel use)
 */
export async function removeAtlasTexture(textureId: string): Promise<boolean> {
  try {
    await atlasManager.initialize();
    const removed = await atlasManager.removeTexture(textureId);

    if (removed) {
      await atlasManager.save();
      console.log(`[AtlasSync] Removed texture ${textureId}`);
    }

    return removed;
  } catch (error) {
    console.error(`[AtlasSync] Failed to remove texture ${textureId}:`, error);
    return false;
  }
}

/**
 * Standalone atlas sync for initialization (not a React hook)
 * Fetches definitions directly from Supabase and syncs to atlas.
 * Call this during app initialization to ensure atlas is populated before rendering.
 */
export async function syncAtlasOnInit(): Promise<void> {
  await atlasManager.initialize();

  // Fetch all definitions in parallel
  const [
    seedsResult,
    shwarmsResult,
    shombiesResult,
    shnakesResult,
    walapasResult,
    blocksResult,
  ] = await Promise.all([
    supabase.from('seed_definitions').select('*').order('tier'),
    supabase.from('shwarm_definitions').select('tier, texture_url').order('tier'),
    supabase.from('shombie_definitions').select('tier, texture_url').order('tier'),
    supabase.from('shnake_definitions').select('tier, head_texture_url, body_texture_url, face_texture_url').order('tier'),
    supabase.from('walapa_definitions').select('tier, body_texture_url, belly_texture_url, eyes_texture_url').order('tier'),
    supabase.from('block_types').select('name, texture_url'),
  ]);

  const seedDefinitions = seedsResult.data;
  const shwarmDefinitions = shwarmsResult.data;
  const shombieDefinitions = shombiesResult.data;
  const shnakeDefinitions = shnakesResult.data;
  const walapaDefinitions = walapasResult.data;
  const blockTypes = blocksResult.data;

  // Build batch of all texture specs for parallel loading
  const specs: Array<{
    textureId: string;
    category: string;
    sourceUrl: string | null;
    slotIndex?: number;
  }> = [];

  // Tree textures (30 tiers × 3 types) with deterministic slots
  if (seedDefinitions) {
    for (let tier = 1; tier <= 30; tier++) {
      const def = seedDefinitions.find(d => d.tier === tier);
      const baseSlot = (tier - 1) * 3;
      specs.push({ textureId: getTreeTextureId(tier, 'trunk'), category: 'tree', sourceUrl: def?.trunk_texture_url || null, slotIndex: baseSlot });
      specs.push({ textureId: getTreeTextureId(tier, 'branch'), category: 'tree', sourceUrl: def?.branch_texture_url || def?.trunk_texture_url || null, slotIndex: baseSlot + 1 });
      specs.push({ textureId: getTreeTextureId(tier, 'fruit'), category: 'tree', sourceUrl: def?.fruit_texture_url || def?.trunk_texture_url || null, slotIndex: baseSlot + 2 });
    }
  }

  // Fungal tree textures with deterministic slots
  // Always allocate slots even when URLs are null — otherwise blocks render black
  if (seedDefinitions) {
    for (const def of seedDefinitions) {
      if ((def as any).tree_type === 'fungal' || (def as any).fungal_stem_texture_url || (def as any).fungal_cap_top_texture_url || (def as any).fungal_cap_underside_texture_url) {
        const stemSlot = calculateFungalTreeSlotIndex(def.tier, 'stem');
        const capTopSlot = calculateFungalTreeSlotIndex(def.tier, 'cap_top');
        const capUnderSlot = calculateFungalTreeSlotIndex(def.tier, 'cap_underside');
        specs.push({ textureId: getFungalTreeTextureId(def.tier, 'stem'), category: 'fungal_tree', sourceUrl: (def as any).fungal_stem_texture_url || (def as any).trunk_texture_url || null, slotIndex: stemSlot });
        specs.push({ textureId: getFungalTreeTextureId(def.tier, 'cap_top'), category: 'fungal_tree', sourceUrl: (def as any).fungal_cap_top_texture_url || (def as any).trunk_texture_url || null, slotIndex: capTopSlot });
        specs.push({ textureId: getFungalTreeTextureId(def.tier, 'cap_underside'), category: 'fungal_tree', sourceUrl: (def as any).fungal_cap_underside_texture_url || (def as any).trunk_texture_url || null, slotIndex: capUnderSlot });
      }
    }
  }

  if (shwarmDefinitions) {
    for (const def of shwarmDefinitions) {
      specs.push({ textureId: getShwarmTextureId(def.tier), category: 'shwarm', sourceUrl: def.texture_url || null });
    }
  }

  if (shombieDefinitions) {
    for (const def of shombieDefinitions) {
      specs.push({ textureId: getShombieTextureId(def.tier), category: 'shombie', sourceUrl: def.texture_url || null });
    }
  }

  if (shnakeDefinitions) {
    for (const def of shnakeDefinitions) {
      specs.push({ textureId: getShnakeTextureId(def.tier, 'head'), category: 'shnake', sourceUrl: def.head_texture_url || null });
      specs.push({ textureId: getShnakeTextureId(def.tier, 'body'), category: 'shnake', sourceUrl: def.body_texture_url || null });
      specs.push({ textureId: getShnakeTextureId(def.tier, 'face'), category: 'shnake', sourceUrl: def.face_texture_url || null });
    }
  }

  if (walapaDefinitions) {
    for (const def of walapaDefinitions) {
      specs.push({ textureId: getWalapaTextureId(def.tier, 'body'), category: 'walapa', sourceUrl: def.body_texture_url || null });
      specs.push({ textureId: getWalapaTextureId(def.tier, 'belly'), category: 'walapa', sourceUrl: def.belly_texture_url || null });
      specs.push({ textureId: getWalapaTextureId(def.tier, 'eyes'), category: 'walapa', sourceUrl: def.eyes_texture_url || null });
    }
  }

  if (blockTypes) {
    for (const block of blockTypes) {
      if (block.texture_url) {
        specs.push({ textureId: getBlockTextureId(block.name), category: 'block', sourceUrl: block.texture_url });
      }
    }
  }

  specs.push({ textureId: getGlobalTextureId('coin'), category: 'global', sourceUrl: '/waterfall_coin.png' });
  specs.push({ textureId: getGlobalTextureId('cliff'), category: 'global', sourceUrl: '/cliff_texture_seamless.webp' });
  specs.push({ textureId: getGlobalTextureId('grass'), category: 'global', sourceUrl: '/grass_texture_seamless.webp' });

  // Batch load all images in parallel and draw to atlas
  await atlasManager.batchSetTextures(specs);

  // Save to IndexedDB
  await atlasManager.save();

  // Update THREE.js texture
  const atlasTexture = getGlobalAtlasTexture();
  if (atlasTexture) {
    const canvas = atlasManager.getCanvas();
    if (canvas) {
      atlasTexture.image = canvas;
      atlasTexture.needsUpdate = true;
      incrementAtlasVersion();
    }
  }

  console.log('[AtlasSync] Initial sync complete');
}
