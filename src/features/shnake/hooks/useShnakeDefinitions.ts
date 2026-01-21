import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShnakeDefinition, ShnakeDefinitionRow } from '../types';

function rowToDefinition(row: ShnakeDefinitionRow): ShnakeDefinition {
  return {
    id: row.id,
    tier: row.tier,
    name: row.name,
    head_texture_url: row.head_texture_url,
    body_texture_url: row.body_texture_url,
    face_texture_url: row.face_texture_url,
    health_per_segment: row.health_per_segment,
    damage_per_hit: row.damage_per_hit,
    knockback: Number(row.knockback),
    armor: row.armor,
    speed: Number(row.speed),
    spawn_chance_per_minute: Number(row.spawn_chance_per_minute),
    max_spawn_per_tree: row.max_spawn_per_tree,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

export function useShnakeDefinitions() {
  return useQuery({
    queryKey: ['shnake-definitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shnake_definitions')
        .select('*')
        .order('tier', { ascending: true });
      if (error) throw error;
      return (data as ShnakeDefinitionRow[]).map(rowToDefinition);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function getShnakeDefinitionByTier(
  definitions: ShnakeDefinition[] | undefined,
  tier: number
): ShnakeDefinition | null {
  if (!definitions || definitions.length === 0) return null;
  return definitions.find(d => d.tier === tier) ?? null;
}
