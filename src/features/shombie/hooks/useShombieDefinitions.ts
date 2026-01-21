import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShombieDefinition } from '../types';

// Module-level cache for fast tier lookups
let definitionsCache: ShombieDefinition[] = [];

/**
 * Fetch all shombie definitions from the database
 */
export function useShombieDefinitions() {
  return useQuery({
    queryKey: ['shombie-definitions'],
    queryFn: async (): Promise<ShombieDefinition[]> => {
      const { data, error } = await supabase
        .from('shombie_definitions')
        .select('*')
        .order('tier', { ascending: true });
      
      if (error) {
        console.error('[ShombieDefinitions] Error fetching:', error);
        throw error;
      }
      
      const defs = (data || []) as ShombieDefinition[];
      definitionsCache = defs;
      console.log(`[ShombieDefinitions] Loaded ${defs.length} definitions`);
      return defs;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Get a shombie definition by tier (synchronous, uses cache)
 */
export function getShombieDefinitionByTier(tier: number): ShombieDefinition | null {
  return definitionsCache.find(d => d.tier === tier) || null;
}

/**
 * Get the definitions cache directly
 */
export function getShombieDefinitionsCache(): ShombieDefinition[] {
  return definitionsCache;
}
