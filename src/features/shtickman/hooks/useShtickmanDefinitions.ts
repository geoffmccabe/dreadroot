import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShtickmanDefinition } from '../types';

// Module-level cache for fast tier lookups
let definitionsCache: ShtickmanDefinition[] = [];

/**
 * Generate fallback definitions when database is unavailable
 * Uses local bamboo textures from /public/
 */
function generateFallbackDefinitions(): ShtickmanDefinition[] {
  const defs: ShtickmanDefinition[] = [];
  for (let tier = 1; tier <= 10; tier++) {
    // Use bamboo textures from public folder
    const textureUrl = `/Bamboo_Seamless_t${tier}.webp`;
    defs.push({
      id: `fallback_${tier}`,
      tier,
      name: 'Shtickman',
      body_texture_url: textureUrl,
      head_texture_url: textureUrl,
      face_texture_url: null,
      roar_sound_url: null,
      throw_sound_url: null,
      death_sound_url: null,
      proximity_sound_url: null,
      speed: 3.0 + (tier - 1) * 0.1,
      health: 300 + (tier - 1) * 50,
      damage_per_hit: 0,
      knockback_received: 1.0,
      ai_config: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  return defs;
}

/**
 * Fetch all shtickman definitions from the database
 */
export function useShtickmanDefinitions() {
  return useQuery({
    queryKey: ['shtickman-definitions'],
    queryFn: async (): Promise<ShtickmanDefinition[]> => {
      try {
        const { data, error } = await supabase
          .from('shtickman_definitions')
          .select('*')
          .order('tier', { ascending: true });

        if (error) {
          console.error('[ShtickmanDefinitions] Error fetching (using fallback):', error);
          // Return fallback definitions if database table doesn't exist
          const fallback = generateFallbackDefinitions();
          definitionsCache = fallback;
          return fallback;
        }

        // If no data returned, use fallback
        if (!data || data.length === 0) {
          console.log('[ShtickmanDefinitions] No definitions in database, using fallback');
          const fallback = generateFallbackDefinitions();
          definitionsCache = fallback;
          return fallback;
        }

        const defs = data as ShtickmanDefinition[];
        definitionsCache = defs;
        console.log(`[ShtickmanDefinitions] Loaded ${defs.length} definitions from database`);
        return defs;
      } catch (err) {
        console.error('[ShtickmanDefinitions] Exception fetching (using fallback):', err);
        const fallback = generateFallbackDefinitions();
        definitionsCache = fallback;
        return fallback;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false, // Don't retry if table doesn't exist
    // Provide initial data so spawning works immediately
    initialData: generateFallbackDefinitions(),
  });
}

/**
 * Get a shtickman definition by tier (synchronous, uses cache)
 */
export function getShtickmanDefinitionByTier(tier: number): ShtickmanDefinition | null {
  return definitionsCache.find(d => d.tier === tier) || null;
}

/**
 * Get the definitions cache directly
 */
export function getShtickmanDefinitionsCache(): ShtickmanDefinition[] {
  return definitionsCache;
}
