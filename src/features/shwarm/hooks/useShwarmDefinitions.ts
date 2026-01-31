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
    drop_rate: row.drop_rate ?? null,
    drop_table_code: row.drop_table_code ?? null,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

/**
 * Create a default definition for a tier that doesn't exist in the DB
 */
function createDefaultDefinition(tier: number): ShwarmDefinition {
  return {
    id: `default-${tier}`,
    tier,
    name: `Tier ${tier} Shwarm`,
    texture_url: null,
    speed: 3.0 + tier * 0.5,
    min_blocks: 10 + tier * 5,
    max_blocks: 20 + tier * 10,
    health_per_block: 30 + tier * 20,
    damage_per_hit: 5 + tier * 3,
    spawn_chance_per_minute: Math.max(0.1, 2.0 - tier * 0.2),
    x_factor: Math.min(5, 1 + Math.floor(tier / 2)),
    drop_rate: tier * 1.0,
    drop_table_code: 'DT1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Hook to fetch shwarm definitions from database.
 * Fills in default definitions for any missing tiers (1-10).
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

      const dbDefs = (data as ShwarmDefinitionRow[]).map(rowToDefinition);
      const existingTiers = new Set(dbDefs.map(d => d.tier));

      // Fill in defaults for missing tiers so T6-T10 are always spawnable
      for (let tier = 1; tier <= 10; tier++) {
        if (!existingTiers.has(tier)) {
          dbDefs.push(createDefaultDefinition(tier));
        }
      }

      dbDefs.sort((a, b) => a.tier - b.tier);
      return dbDefs;
    },
    staleTime: 30 * 1000, // 30 seconds - allow admin panel changes to propagate quickly
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
