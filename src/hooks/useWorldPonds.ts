/**
 * useWorldPonds Hook
 *
 * Manages pond data for a world:
 * - Fetches pond definitions from database
 * - Generates water blocks for visible chunks
 * - Provides pond queries (is in water, water type, etc.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  type WorldPond,
  fetchWorldPonds,
  isInWater,
  getWaterTypeAt,
  type WaterType,
} from '@/lib/pondGenerator';
import {
  generatePondBlocksForChunk,
  type WaterBlock,
  type WaterBlocksForChunk,
} from '@/lib/pondBlockGenerator';

// ============================================
// Types
// ============================================

export interface WorldPondSettings {
  waterTintColor: string;
  lavaTintColor: string;
  waterSurfaceTextureUrl: string | null;
  lavaSurfaceTextureUrl: string | null;
}

export interface WorldPondsState {
  ponds: WorldPond[];
  settings: WorldPondSettings;
  isLoading: boolean;
  error: Error | null;
}

// ============================================
// Constants
// ============================================

const DEFAULT_WATER_TINT = '#88ddff';
const DEFAULT_LAVA_TINT = '#ff6622';

// Cache for water blocks per chunk
const waterBlocksCache = new Map<string, WaterBlocksForChunk>();

// ============================================
// Hook
// ============================================

export function useWorldPonds(worldId: string | null) {
  const [state, setState] = useState<WorldPondsState>({
    ponds: [],
    settings: {
      waterTintColor: DEFAULT_WATER_TINT,
      lavaTintColor: DEFAULT_LAVA_TINT,
      waterSurfaceTextureUrl: null,
      lavaSurfaceTextureUrl: null,
    },
    isLoading: true,
    error: null,
  });

  // Track current world ID to prevent stale data
  const currentWorldIdRef = useRef<string | null>(null);

  // Fetch ponds and settings when world changes
  useEffect(() => {
    if (!worldId) {
      setState({
        ponds: [],
        settings: {
          waterTintColor: DEFAULT_WATER_TINT,
          lavaTintColor: DEFAULT_LAVA_TINT,
          waterSurfaceTextureUrl: null,
          lavaSurfaceTextureUrl: null,
        },
        isLoading: false,
        error: null,
      });
      return;
    }

    currentWorldIdRef.current = worldId;

    const loadPonds = async () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        // Fetch ponds
        const ponds = await fetchWorldPonds(worldId);

        // Fetch world settings for tint colors
        const { data: worldData, error: worldError } = await supabase
          .from('worlds')
          .select('water_tint_color, lava_tint_color, water_surface_texture_url, lava_surface_texture_url')
          .eq('id', worldId)
          .single();

        if (worldError) {
          console.warn('[useWorldPonds] Failed to fetch world settings:', worldError);
        }

        // Only update if still the current world
        if (currentWorldIdRef.current !== worldId) return;

        setState({
          ponds,
          settings: {
            waterTintColor: (worldData as any)?.water_tint_color || DEFAULT_WATER_TINT,
            lavaTintColor: (worldData as any)?.lava_tint_color || DEFAULT_LAVA_TINT,
            waterSurfaceTextureUrl: (worldData as any)?.water_surface_texture_url || null,
            lavaSurfaceTextureUrl: (worldData as any)?.lava_surface_texture_url || null,
          },
          isLoading: false,
          error: null,
        });

        console.log(`[useWorldPonds] Loaded ${ponds.length} ponds for world ${worldId}`);
      } catch (err) {
        console.error('[useWorldPonds] Error loading ponds:', err);

        if (currentWorldIdRef.current !== worldId) return;

        setState(prev => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err : new Error('Failed to load ponds'),
        }));
      }
    };

    loadPonds();

    // Clear cache when world changes
    waterBlocksCache.clear();
  }, [worldId]);

  // Generate water blocks for a chunk (with caching)
  const getWaterBlocksForChunk = useCallback(
    (chunkX: number, chunkZ: number, chunkSize: number = 16): WaterBlock[] => {
      const cacheKey = `${chunkX},${chunkZ}`;

      // Check cache
      const cached = waterBlocksCache.get(cacheKey);
      if (cached) {
        return cached.blocks;
      }

      // Generate blocks
      const result = generatePondBlocksForChunk(state.ponds, chunkX, chunkZ, chunkSize);

      // Cache result
      waterBlocksCache.set(cacheKey, result);

      return result.blocks;
    },
    [state.ponds]
  );

  // Check if a position is in water
  const checkIsInWater = useCallback(
    (x: number, y: number, z: number): boolean => {
      return isInWater(state.ponds, x, y, z);
    },
    [state.ponds]
  );

  // Get water type at position
  const getWaterType = useCallback(
    (x: number, y: number, z: number): WaterType | null => {
      return getWaterTypeAt(state.ponds, x, y, z);
    },
    [state.ponds]
  );

  // Get all water blocks for visible chunks
  const getAllWaterBlocksForChunks = useCallback(
    (chunkKeys: string[], chunkSize: number = 16): WaterBlock[] => {
      const allBlocks: WaterBlock[] = [];

      for (const key of chunkKeys) {
        const match = key.match(/chunk_(-?\d+)_(-?\d+)/);
        if (!match) continue;

        const chunkX = parseInt(match[1], 10);
        const chunkZ = parseInt(match[2], 10);

        const blocks = getWaterBlocksForChunk(chunkX, chunkZ, chunkSize);
        allBlocks.push(...blocks);
      }

      return allBlocks;
    },
    [getWaterBlocksForChunk]
  );

  // Clear cache (for when ponds change)
  const clearCache = useCallback(() => {
    waterBlocksCache.clear();
  }, []);

  return {
    ...state,
    getWaterBlocksForChunk,
    getAllWaterBlocksForChunks,
    checkIsInWater,
    getWaterType,
    clearCache,
    hasPonds: state.ponds.length > 0,
  };
}

// ============================================
// Exported utilities
// ============================================

/**
 * Clear the water blocks cache
 */
export function clearWaterBlocksCache() {
  waterBlocksCache.clear();
}
