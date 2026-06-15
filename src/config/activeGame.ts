// Runtime active-game switch. GAME_ID is the build-time default; this lets the in-game
// switcher (top-right) flip between games at runtime so we can test SW vs DR features
// without separate deploys. The chosen game persists and the app reads it on boot to
// decide which world/modules + styling to load.
import { useSyncExternalStore } from 'react';
import { GAME_ID } from '@/config/game';

const KEY = 'activeGame';
let active: string =
  (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || GAME_ID;

const subs = new Set<() => void>();

export function getActiveGame(): string {
  return active;
}

export function setActiveGame(game: string): void {
  if (game === active) return;
  active = game;
  try { localStorage.setItem(KEY, game); } catch { /* ignore */ }
  subs.forEach((f) => f());
  // Reload so the app re-boots into the chosen game's world: FortressScene reads
  // getActiveGame() and renders the voxel world (dreadroot) OR the SW terrain+monsters
  // (siege-worlds). Switching is gated entirely by this flag, so the live Dreadroot
  // game is untouched unless the player explicitly picks Siege Worlds.
  if (typeof window !== 'undefined') window.location.reload();
}

export function useActiveGame(): string {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getActiveGame,
    getActiveGame,
  );
}
