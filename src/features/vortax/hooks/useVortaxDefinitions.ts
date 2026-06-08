import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { VortaxDefinition } from '../types';

// Module-level cache for fast tier lookups
let definitionsCache: VortaxDefinition[] = [];

/**
 * Fetch all vortax definitions from the database.
 * Uses `.from('vortax_definitions' as any)` so we don't have to regenerate
 * the Supabase types — the row shape matches VortaxDefinition.
 */
export function useVortaxDefinitions() {
  return useQuery({
    queryKey: ['vortax-definitions'],
    queryFn: async (): Promise<VortaxDefinition[]> => {
      const { data, error } = await supabase
        .from('vortax_definitions' as any)
        .select('*')
        .order('tier', { ascending: true });

      if (error) {
        console.error('[VortaxDefinitions] Error fetching:', error);
        throw error;
      }

      const defs = ((data || []) as unknown) as VortaxDefinition[];
      definitionsCache = defs;
      console.log(`[VortaxDefinitions] Loaded ${defs.length} definitions`);
      return defs;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Get a vortax definition by tier (synchronous, uses cache)
 */
export function getVortaxDefinitionByTier(tier: number): VortaxDefinition | null {
  return definitionsCache.find(d => d.tier === tier) || null;
}

/**
 * Get the definitions cache directly
 */
export function getVortaxDefinitionsCache(): VortaxDefinition[] {
  return definitionsCache;
}
