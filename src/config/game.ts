// Single source of truth for which game THIS deployment is.
//
// Multi-game framework: the same engine codebase is deployed once per game, each
// with its own VITE_GAME_ID env var. One shared Supabase backs them all; world-
// scoped, monster-definition, and performance-stat rows carry a `game`
// discriminator so games stay separate (ownership — accounts, inventory, items,
// coins — is shared). Every query that reads those tables must filter by GAME_ID,
// and every insert/RPC must pass it.
//
// Defaults to 'dreadroot' when VITE_GAME_ID is unset.
export const GAME_ID: string = (import.meta.env.VITE_GAME_ID as string | undefined) ?? 'dreadroot';

// GAME_ID also IS this game's slug in the cross-game creature registry
// (games.slug). The same value selects this game's rows everywhere.

/**
 * Creature slugs this BUILD actually ships renderers + design panels for. The
 * registry (game_creatures) decides which of these are enabled + their order;
 * this list is (a) the allow-list of what this build can render, and (b) the
 * fallback roster if the registry hasn't been seeded yet, so the admin panel
 * never breaks. A registry creature whose slug isn't shipped here is skipped
 * (its renderer doesn't exist in this build yet — see cross-game phase).
 */
export const SHIPPED_CREATURE_SLUGS = [
  'shwarm', 'shnake', 'shombie', 'shroomer', 'vortax', 'shtickman', 'shpider', 'walapa',
] as const;

export type ShippedCreatureSlug = (typeof SHIPPED_CREATURE_SLUGS)[number];
