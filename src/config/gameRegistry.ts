// Universal-engine GAME REGISTRY.
//
// One entry per game describing its capabilities, so adding a game (Pinkland, a
// future world, …) is a single registry entry instead of edits scattered across
// the codebase. This is the single source of truth the switcher + engine read.
//
// Two distinct notions of "game" live here:
//   * render-mode  — does the game render the voxel block world, or its own terrain
//                    (Siege Worlds)? Controlled by `usesVoxelWorld`.
//   * data-game    — which `worlds` rows / per-game data it loads. Controlled by
//                    `worldsTableKey` (null = no worlds-table world; rides on the
//                    build's default data-game, e.g. Siege Worlds on Dreadroot).
//
// Today only Dreadroot + Siege Worlds are `enabled`. Pinkland is described but
// gated off until its per-game DATA hooks (chat, leaderboards, stats, creatures,
// coin-drops, effects) are made reactive to the runtime game — see notes in the
// audit. Keeping it here means enabling it later is a one-line flip + that pass.

import { GAME_ID } from '@/config/game';

export interface GameDef {
  /** Runtime id, matches activeGame + the GameSwitcher selection. */
  id: string;
  label: string;
  /** Selectable in the switcher. */
  enabled: boolean;
  /** Renders the voxel block world (atlas + chunks from the worlds table). */
  usesVoxelWorld: boolean;
  /** `worlds.game` value to load. null = no worlds-table world (Siege Worlds). */
  worldsTableKey: string | null;
  /** Optional global hue-shift (degrees), e.g. Pinkland. null = none. */
  hue: number | null;
}

// ⚠ Adding a game here is NOT enough to make the engine treat it as non-voxel. About twenty
// call sites decide "am I in Siege?" with a literal `activeGame === 'siege-worlds'` rather than
// asking this registry, so a new non-voxel id silently renders as DreadRoot. Starblink hit exactly
// that and is therefore NOT a game here: it is Siege Worlds booted onto a different map (BOOT_MAP
// in config/game.ts). Converting those call sites to gameUsesVoxels() is the real fix, later.
export const GAMES: Record<string, GameDef> = {
  'dreadroot': {
    id: 'dreadroot', label: 'Dreadroot', enabled: true,
    usesVoxelWorld: true, worldsTableKey: 'dreadroot', hue: null,
  },
  'siege-worlds': {
    id: 'siege-worlds', label: 'Siege Worlds', enabled: true,
    usesVoxelWorld: false, worldsTableKey: null, hue: null,
  },
  'pinkland': {
    id: 'pinkland', label: 'Pinkland', enabled: false,
    usesVoxelWorld: true, worldsTableKey: 'pinkland', hue: 320,
  },
};

const FALLBACK = GAMES['dreadroot'];

export const GAME_LIST: GameDef[] = Object.values(GAMES);

export function getGameDef(id: string): GameDef {
  return GAMES[id] ?? FALLBACK;
}

/** Does this game render the voxel block world (vs its own terrain like Siege)? */
export function gameUsesVoxels(id: string): boolean {
  return getGameDef(id).usesVoxelWorld;
}

/**
 * The data-scoping key for per-game DB rows (worlds, chat, leaderboards, stats,
 * coin-drops, creatures…). Games without their own data-game (Siege Worlds) ride
 * on the BUILD's default, preserving today's behavior where siege runs on the
 * Dreadroot data session. Use this for any query/channel keyed by a `game` column.
 */
export function gameDataKey(id: string): string {
  return getGameDef(id).worldsTableKey ?? GAME_ID;
}

/** Alias of {@link gameDataKey} for the worlds table specifically. */
export function gameWorldsKey(id: string): string {
  return gameDataKey(id);
}
