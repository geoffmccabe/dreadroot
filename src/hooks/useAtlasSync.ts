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
  getGlobalTextureId,
} from '@/lib/atlasLookup';
import { getGlobalAtlasTexture, incrementAtlasVersion } from '@/hooks/useTextureAtlas';
import { initLogStartStep, initLogFinishStep, initLogStep, initLogErrorStep } from '@/contexts/InitializationContext';

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
        .from('walapa_definitions' as any)
        .select('tier, body_texture_url, belly_texture_url, eyes_texture_url')
        .order('tier');
      if (error) throw error;
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = loadingSeeds || loadingShwarms || loadingShombies || loadingShnakes || loadingWalapas;

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

      // Tree textures (30 tiers × 3 types) — dynamic allocation (no slotIndex)
      // Animated textures auto-allocate N consecutive slots based on URL metadata
      // Filter to 'original' tree type to avoid using fungal definitions
      if (seedDefinitions) {
        const fruitDiag: string[] = [];
        for (let tier = 1; tier <= 30; tier++) {
          const def = seedDefinitions.find(d => d.tier === tier && (d.tree_type || 'original') === 'original');
          const fruitUrl = def?.fruit_texture_url || def?.branch_texture_url || def?.trunk_texture_url || null;
          specs.push({ textureId: getTreeTextureId(tier, 'trunk'), category: 'tree', sourceUrl: def?.trunk_texture_url || null });
          specs.push({ textureId: getTreeTextureId(tier, 'branch'), category: 'tree', sourceUrl: def?.branch_texture_url || def?.trunk_texture_url || null });
          specs.push({ textureId: getTreeTextureId(tier, 'fruit'), category: 'tree', sourceUrl: fruitUrl });
          // Track which URL source was used for fruit
          const src = def?.fruit_texture_url ? 'fruit' : def?.branch_texture_url ? 'branch' : def?.trunk_texture_url ? 'trunk' : 'NONE';
          if (!def) fruitDiag.push(`T${tier}:NO_DEF`);
          else if (src === 'NONE') fruitDiag.push(`T${tier}:NULL`);
          else if (src !== 'fruit') fruitDiag.push(`T${tier}:${src}`);
        }
        if (fruitDiag.length > 0) {
          console.warn(`[AtlasSync] Fruit texture issues: ${fruitDiag.join(', ')}`);
        }
        console.log(`[AtlasSync] seedDefinitions count=${seedDefinitions.length}, tree_types: ${[...new Set(seedDefinitions.map(d => d.tree_type || 'null'))].join(',')}`);
      }

      // Fungal tree textures (30 tiers × 3 types) with deterministic slots
      // Filter to 'fungal' tree type; fall back to trunk_texture_url for missing fungal-specific URLs
      if (seedDefinitions) {
        for (let tier = 1; tier <= 30; tier++) {
          const def = seedDefinitions.find(d => d.tier === tier && d.tree_type === 'fungal')
            || seedDefinitions.find(d => d.tier === tier && (d.tree_type || 'original') === 'original');
          const stemSlot = calculateFungalTreeSlotIndex(tier, 'stem');
          const capTopSlot = calculateFungalTreeSlotIndex(tier, 'cap_top');
          const capUnderSlot = calculateFungalTreeSlotIndex(tier, 'cap_underside');
          specs.push({ textureId: getFungalTreeTextureId(tier, 'stem'), category: 'fungal_tree', sourceUrl: def?.fungal_stem_texture_url || def?.trunk_texture_url || null, slotIndex: stemSlot });
          specs.push({ textureId: getFungalTreeTextureId(tier, 'cap_top'), category: 'fungal_tree', sourceUrl: def?.fungal_cap_top_texture_url || def?.trunk_texture_url || null, slotIndex: capTopSlot });
          specs.push({ textureId: getFungalTreeTextureId(tier, 'cap_underside'), category: 'fungal_tree', sourceUrl: def?.fungal_cap_underside_texture_url || def?.trunk_texture_url || null, slotIndex: capUnderSlot });
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

      // Global textures
      specs.push({ textureId: getGlobalTextureId('coin'), category: 'global', sourceUrl: '/waterfall_coin.png' });
      specs.push({ textureId: getGlobalTextureId('cliff'), category: 'global', sourceUrl: '/cliff_texture_seamless.webp' });
      specs.push({ textureId: getGlobalTextureId('grass'), category: 'global', sourceUrl: '/grass_texture_seamless.webp' });

      // Batch load all images in parallel and draw to atlas
      const processed = await atlasManager.batchSetTextures(specs);
      initLogStep('useAtlasSync.ts', 'All textures synced (parallel)', processed);

      // Only save/upload/bump version if textures actually changed
      if (processed > 0) {
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
      }

      const stats = atlasManager.getStats();
      if (stepId) initLogFinishStep(stepId, stats.usedSlots);

      console.log(`[AtlasSync] Sync complete: ${stats.usedSlots} slots used`, stats.byCategory);

      return result;
    } finally {
      syncInProgressRef.current = false;
    }
  }, [seedDefinitions, shwarmDefinitions, shombieDefinitions, shnakeDefinitions, walapaDefinitions]);

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
    },
  };
}

/**
 * Update a single texture in the atlas (for admin panel use)
 */
export async function updateAtlasTexture(
  category: 'tree' | 'shwarm' | 'shombie' | 'shnake' | 'walapa' | 'global',
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
  const stepId = initLogStartStep('useAtlasSync.ts', 'Syncing textures to atlas...');

  try {
    await atlasManager.initialize();

  // Fetch all definitions in parallel
  const [
    seedsResult,
    shwarmsResult,
    shombiesResult,
    shnakesResult,
    walapasResult,
  ] = await Promise.all([
    supabase.from('seed_definitions').select('*').order('tier'),
    supabase.from('shwarm_definitions').select('tier, texture_url').order('tier'),
    supabase.from('shombie_definitions').select('tier, texture_url').order('tier'),
    supabase.from('shnake_definitions').select('tier, head_texture_url, body_texture_url, face_texture_url').order('tier'),
    supabase.from('walapa_definitions' as any).select('tier, body_texture_url, belly_texture_url, eyes_texture_url').order('tier'),
  ]);

  const seedDefinitions = seedsResult.data;
  const shwarmDefinitions = shwarmsResult.data;
  const shombieDefinitions = shombiesResult.data;
  const shnakeDefinitions = shnakesResult.data;
  const walapaDefinitions = walapasResult.data;

  // Build batch of all texture specs for parallel loading
  const specs: Array<{
    textureId: string;
    category: string;
    sourceUrl: string | null;
    slotIndex?: number;
  }> = [];

  // Tree textures (30 tiers × 3 types) — dynamic allocation (no slotIndex)
  // Filter to 'original' tree type to avoid using fungal definitions
  if (seedDefinitions) {
    const fruitDiag: string[] = [];
    for (let tier = 1; tier <= 30; tier++) {
      const def = seedDefinitions.find((d: any) => d.tier === tier && (d.tree_type || 'original') === 'original');
      const fruitUrl = def?.fruit_texture_url || def?.branch_texture_url || def?.trunk_texture_url || null;
      specs.push({ textureId: getTreeTextureId(tier, 'trunk'), category: 'tree', sourceUrl: def?.trunk_texture_url || null });
      specs.push({ textureId: getTreeTextureId(tier, 'branch'), category: 'tree', sourceUrl: def?.branch_texture_url || def?.trunk_texture_url || null });
      specs.push({ textureId: getTreeTextureId(tier, 'fruit'), category: 'tree', sourceUrl: fruitUrl });
      const src = def?.fruit_texture_url ? 'fruit' : def?.branch_texture_url ? 'branch' : def?.trunk_texture_url ? 'trunk' : 'NONE';
      if (!def) fruitDiag.push(`T${tier}:NO_DEF`);
      else if (src === 'NONE') fruitDiag.push(`T${tier}:NULL`);
      else if (src !== 'fruit') fruitDiag.push(`T${tier}:${src}`);
    }
    if (fruitDiag.length > 0) {
      console.warn(`[AtlasSync:init] Fruit texture issues: ${fruitDiag.join(', ')}`);
    }
    console.log(`[AtlasSync:init] seedDefinitions count=${seedDefinitions.length}, tree_types: ${[...new Set(seedDefinitions.map((d: any) => d.tree_type || 'null'))].join(',')}`);
  }

  // Fungal tree textures (30 tiers × 3 types) with deterministic slots
  // Filter to 'fungal' tree type; fall back to trunk_texture_url for missing fungal-specific URLs
  if (seedDefinitions) {
    for (let tier = 1; tier <= 30; tier++) {
      const def = seedDefinitions.find(d => d.tier === tier && d.tree_type === 'fungal')
        || seedDefinitions.find(d => d.tier === tier && (d.tree_type || 'original') === 'original');
      const stemSlot = calculateFungalTreeSlotIndex(tier, 'stem');
      const capTopSlot = calculateFungalTreeSlotIndex(tier, 'cap_top');
      const capUnderSlot = calculateFungalTreeSlotIndex(tier, 'cap_underside');
      specs.push({ textureId: getFungalTreeTextureId(tier, 'stem'), category: 'fungal_tree', sourceUrl: def?.fungal_stem_texture_url || def?.trunk_texture_url || null, slotIndex: stemSlot });
      specs.push({ textureId: getFungalTreeTextureId(tier, 'cap_top'), category: 'fungal_tree', sourceUrl: def?.fungal_cap_top_texture_url || def?.trunk_texture_url || null, slotIndex: capTopSlot });
      specs.push({ textureId: getFungalTreeTextureId(tier, 'cap_underside'), category: 'fungal_tree', sourceUrl: def?.fungal_cap_underside_texture_url || def?.trunk_texture_url || null, slotIndex: capUnderSlot });
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

  specs.push({ textureId: getGlobalTextureId('coin'), category: 'global', sourceUrl: '/waterfall_coin.png' });
  specs.push({ textureId: getGlobalTextureId('cliff'), category: 'global', sourceUrl: '/cliff_texture_seamless.webp' });
  specs.push({ textureId: getGlobalTextureId('grass'), category: 'global', sourceUrl: '/grass_texture_seamless.webp' });

  // Batch load all images in parallel and draw to atlas
  const processed = await atlasManager.batchSetTextures(specs);

  // Only save/upload/bump version if textures actually changed
  if (processed > 0) {
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
  }

  // Log completion with texture count
  const stats = atlasManager.getStats();
  if (stepId) initLogFinishStep(stepId, stats.usedSlots);

  console.log('[AtlasSync] Initial sync complete');
  } catch (error) {
    console.error('[AtlasSync] Initial sync failed:', error);
    if (stepId) initLogErrorStep(stepId, error instanceof Error ? error.message : 'Unknown error');
    // Don't re-throw - atlas sync failure shouldn't block game loading
    // Trees will just use fallback textures
  }
}
