/**
 * Hook for fetching and caching Walapa definitions from database
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { WalapaDefinition } from '../types';

// Module-level cache for synchronous access
let definitionsCache: WalapaDefinition[] = [];

/**
 * Get walapa definition by tier (synchronous, uses cache)
 */
export function getWalapaDefinitionByTier(tier: number): WalapaDefinition | undefined {
  return definitionsCache.find(d => d.tier === tier);
}

/**
 * Get all cached definitions
 */
export function getWalapaDefinitionsCache(): WalapaDefinition[] {
  return definitionsCache;
}

/**
 * Hook to fetch and subscribe to walapa definitions
 */
export function useWalapaDefinitions() {
  const query = useQuery({
    queryKey: ['walapa-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('walapa_definitions' as any)
        .select('*')
        .order('tier', { ascending: true });

      if (error) {
        // Table might not exist - return defaults
        console.warn('[WalapaDefinitions] Fetch error (table may not exist):', error.message);
        // Create default definitions for all 10 tiers
        const defaults: WalapaDefinition[] = [];
        for (let tier = 1; tier <= 10; tier++) {
          defaults.push({
            ...DEFAULT_WALAPA_DEFINITION,
            id: `default_${tier}`,
            tier,
            name: `Tier ${tier} Walapa`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as WalapaDefinition);
        }
        definitionsCache = defaults;
        return defaults;
      }

      // Update module-level cache
      definitionsCache = (data || []) as WalapaDefinition[];
      return definitionsCache;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  return {
    definitions: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Default definition for new tiers
 */
export const DEFAULT_WALAPA_DEFINITION: Omit<WalapaDefinition, 'id' | 'created_at' | 'updated_at'> = {
  tier: 1,
  name: 'Sky Drifter',
  body_texture_url: null,
  belly_texture_url: null,
  eyes_texture_url: null,
  speed: 100, // 100% of player speed
  health: 500,
  wait_time_seconds: 30,
  min_tree_tier: 1, // Visit any tier tree by default
  ai_config: {
    behaviors: ['patrol', 'indignant'],
    detectionRange: 0,
    attackRange: 0,
    attackCooldownMs: 0,
    angrySpeedMultiplier: 1.0,
    angryDurationMs: 0,
  },
  sound_config: null,
};
