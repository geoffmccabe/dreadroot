import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShpiderDefinition } from '../types';

let definitionsCache: ShpiderDefinition[] = [];

export function useShpiderDefinitions() {
  return useQuery({
    queryKey: ['shpider-definitions'],
    queryFn: async (): Promise<ShpiderDefinition[]> => {
      const { data, error } = await (supabase
        .from('shpider_definitions' as any)
        .select('*')
        .order('tier', { ascending: true }) as any);

      if (error) {
        console.error('[ShpiderDefinitions] fetch error:', error);
        return [];
      }
      const defs = (data ?? []) as ShpiderDefinition[];
      definitionsCache = defs;
      return defs;
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}

export function getShpiderDefinitionByTier(tier: number): ShpiderDefinition | null {
  return definitionsCache.find(d => d.tier === tier) || null;
}

export function getShpiderDefinitionsCache(): ShpiderDefinition[] {
  return definitionsCache;
}
