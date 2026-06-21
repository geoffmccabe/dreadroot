// Siege "work mode" — a single OFF-by-default switch for the development/review overlays
// that clutter the world during normal play (the monster review lineup, the Thorn/Shi Yang
// character pair, the "M = cycle animation / @#spawn" hint, and the SIEGE DEBUG panel).
//
// Toggle with ⌘-] (Cmd + right bracket; Ctrl-] also works). Everything gated on useWorkMode()
// stays hidden until you press it, so testing isn't disrupted by work-in-progress displays.
import { useSyncExternalStore } from 'react';

let on = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getWorkMode = (): boolean => on;
export const setWorkMode = (v: boolean): void => { if (v === on) return; on = v; emit(); };
export const toggleWorkMode = (): void => setWorkMode(!on);

let installed = false;
// Install the ⌘-] hotkey once (idempotent — safe to call from any mounting component).
export function installWorkModeHotkey(): () => void {
  if (installed) return () => {};
  installed = true;
  const onKey = (e: KeyboardEvent) => {
    // Cmd-] on Mac (Ctrl-] elsewhere). BracketRight = the ']' physical key.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'BracketRight') {
      e.preventDefault();
      toggleWorkMode();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => { window.removeEventListener('keydown', onKey); installed = false; };
}

export function useWorkMode(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    getWorkMode, getWorkMode,
  );
}
