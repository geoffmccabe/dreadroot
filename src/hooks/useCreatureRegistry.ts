/**
 * useCreatureRegistry — the game-agnostic source of truth for "which creatures
 * does THIS game use, in what order, renamed/recolored how". Reads the
 * cross-game registry (game_creatures → creatures) filtered to this game
 * (active-game data key == games.slug), enabled only.
 *
 * Falls back to the build's SHIPPED_CREATURE_SLUGS if the registry is empty or
 * unreachable, so panels/renderers never break before the registry is seeded.
 * The same code, dropped into another game (Pinkland), automatically returns
 * THAT game's roster — no edits.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SHIPPED_CREATURE_SLUGS } from '@/config/game';
import { useActiveGame } from '@/config/activeGame';
import { gameDataKey } from '@/config/gameRegistry';

export interface RegistryCreature {
  slug: string;
  /** display name (per-game override applied) */
  name: string;
  enabled: boolean;
  /** per-game recolor palette (jsonb; {} = use the creature's own colors) */
  colorOverrides: Record<string, unknown>;
  sortOrder: number;
  /** true if this build actually ships a renderer/design-panel for the slug. */
  shipped: boolean;
}

const SHIPPED = new Set<string>(SHIPPED_CREATURE_SLUGS);

const FALLBACK: RegistryCreature[] = SHIPPED_CREATURE_SLUGS.map((slug, i) => ({
  slug,
  name: slug.charAt(0).toUpperCase() + slug.slice(1),
  enabled: true,
  colorOverrides: {},
  sortOrder: i,
  shipped: true,
}));

export function useCreatureRegistry() {
  const gameKey = gameDataKey(useActiveGame());
  return useQuery({
    queryKey: ['creature-registry', gameKey],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<RegistryCreature[]> => {
      const { data, error } = await supabase
        .from('game_creatures')
        .select('enabled, color_overrides, name_override, sort_order, creatures!inner(slug, name), games!inner(slug)')
        .eq('games.slug', gameKey)
        .eq('enabled', true)
        .order('sort_order');

      if (error || !data || data.length === 0) {
        return FALLBACK; // registry not seeded / unreachable → ship's defaults
      }

      const mapped = data
        .map((row): RegistryCreature | null => {
          // PostgREST returns a to-one embed as an object, but tolerate an array
          // shape too so a relationship-inference quirk can't blank the panel.
          const raw = row.creatures as unknown;
          const creature = (Array.isArray(raw) ? raw[0] : raw) as { slug?: string; name?: string } | undefined;
          if (!creature?.slug) return null;
          return {
            slug: creature.slug,
            name: (row.name_override as string | null) ?? creature.name ?? creature.slug,
            enabled: row.enabled,
            colorOverrides: (row.color_overrides as Record<string, unknown>) ?? {},
            sortOrder: row.sort_order,
            shipped: SHIPPED.has(creature.slug),
          };
        })
        .filter((c): c is RegistryCreature => c !== null);

      // If the rows came back in an unexpected shape, don't show an empty roster.
      return mapped.length > 0 ? mapped : FALLBACK;
    },
  });
}
