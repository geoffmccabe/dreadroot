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
