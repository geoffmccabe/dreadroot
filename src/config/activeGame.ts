// Runtime active-game switch. GAME_ID is the build-time default; this lets the in-game
// switcher (top-right) flip between games at runtime so we can test SW vs DR features
// without separate deploys. The chosen game persists and the app reads it on boot to
// decide which world/modules + styling to load.
import { useSyncExternalStore } from 'react';
import { GAME_ID, BOOT_MAP } from '@/config/game';

const KEY = 'activeGame';
// A boot-map build runs as SIEGE WORLDS, not as some new game of its own. That matters: roughly
// twenty places in the engine decide "am I in Siege?" with a literal comparison to 'siege-worlds',
// so any other id renders the voxel DreadRoot world instead. The remembered choice is ignored
// here on purpose, so the deploy always opens where it is supposed to.
let active: string = BOOT_MAP
  ? 'siege-worlds'
  : ((typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || GAME_ID);

const subs = new Set<() => void>();

export function getActiveGame(): string {
  return active;
}

export function setActiveGame(game: string): void {
  if (game === active) return;
  active = game;
  try { localStorage.setItem(KEY, game); } catch { /* ignore */ }
  // LIVE swap — no page reload. Subscribers (useActiveGame via useSyncExternalStore)
  // re-render, so FortressScene flips isSiege and swaps the world behind the HUD
  // (voxel ↔ siege terrain+monsters) in place. The player is teleported into the new
  // world by FortressScene. Switching is gated by this flag; Dreadroot is untouched.
  subs.forEach((f) => f());
}

export function useActiveGame(): string {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getActiveGame,
    getActiveGame,
  );
}
