import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShroomerDefinition } from '../types';

// Module-level cache for fast tier lookups
let definitionsCache: ShroomerDefinition[] = [];

/**
 * Fetch all shroomer definitions from the database.
 * Uses `.from('shroomer_definitions' as any)` so we don't have to regenerate
 * the Supabase types — the row shape matches ShroomerDefinition.
 */
export function useShroomerDefinitions() {
  return useQuery({
    queryKey: ['shroomer-definitions'],
    queryFn: async (): Promise<ShroomerDefinition[]> => {
      const { data, error } = await supabase
        .from('shroomer_definitions' as any)
        .select('*')
        .order('tier', { ascending: true });

      if (error) {
        console.error('[ShroomerDefinitions] Error fetching:', error);
        throw error;
      }

      const defs = ((data || []) as unknown) as ShroomerDefinition[];
      definitionsCache = defs;
      console.log(`[ShroomerDefinitions] Loaded ${defs.length} definitions`);
      return defs;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Get a shroomer definition by tier (synchronous, uses cache)
 */
export function getShroomerDefinitionByTier(tier: number): ShroomerDefinition | null {
  return definitionsCache.find(d => d.tier === tier) || null;
}

/**
 * Get the definitions cache directly
 */
export function getShroomerDefinitionsCache(): ShroomerDefinition[] {
  return definitionsCache;
}
