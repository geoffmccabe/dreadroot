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
  // NOTE: world-loading on switch is wired once the SW world module lands. Until then,
  // selecting a game just records the choice (the dropdown highlights it) — no reload,
  // so the live Dreadroot game is never disrupted by the in-progress switch.
}

export function useActiveGame(): string {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getActiveGame,
    getActiveGame,
  );
}
