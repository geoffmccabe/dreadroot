import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShwarmDefinition, ShwarmDefinitionRow } from '../types';

/**
 * Converts database row (snake_case) to frontend type (camelCase)
 */
function rowToDefinition(row: ShwarmDefinitionRow): ShwarmDefinition {
  return {
    id: row.id,
    tier: row.tier,
    name: row.name,
    texture_url: row.texture_url,
    speed: row.speed,
    min_blocks: row.min_blocks,
    max_blocks: row.max_blocks,
    health_per_block: row.health_per_block,
    damage_per_hit: row.damage_per_hit,
    spawn_chance_per_minute: row.spawn_chance_per_minute,
    x_factor: row.x_factor,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

/**
 * Hook to fetch shwarm definitions from database
 */
export function useShwarmDefinitions() {
  return useQuery({
    queryKey: ['shwarm-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shwarm_definitions')
        .select('*')
        .order('tier', { ascending: true });

      if (error) throw error;
      return (data as ShwarmDefinitionRow[]).map(rowToDefinition);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - definitions rarely change
  });
}

/**
 * Get a definition by tier (1-10, where 0 maps to tier 10)
 */
export function getDefinitionByTier(
  definitions: ShwarmDefinition[] | undefined,
  tier: number
): ShwarmDefinition | null {
  if (!definitions || definitions.length === 0) return null;
  
  // 0 key means tier 10
  const actualTier = tier === 0 ? 10 : tier;
  
  return definitions.find(d => d.tier === actualTier) ?? null;
}
