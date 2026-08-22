/**
 * Which character this player is using. Temporary by design: players may
 * switch freely at any time, so this is just a local preference for now, not
 * an owned/unlocked entitlement.
 *
 * Kept separate from the roster so the multiplayer layer can read the choice
 * without pulling in any React or 3D code.
 */
import { useSyncExternalStore } from 'react';
import { DREADROOT_CHARACTERS } from './dreadrootCharacters';

const LS_KEY = 'dreadroot.character';
const DEFAULT = DREADROOT_CHARACTERS[0].name;

let selected: string = (() => {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && DREADROOT_CHARACTERS.some((c) => c.name === v)) return v;
  } catch { /* ignore */ }
  return DEFAULT;
})();

let version = 0;
const subs = new Set<() => void>();

export function getSelectedCharacter(): string {
  return selected;
}

export function setSelectedCharacter(name: string): boolean {
  if (!DREADROOT_CHARACTERS.some((c) => c.name === name)) return false;
  if (name === selected) return true;
  selected = name;
  try { localStorage.setItem(LS_KEY, name); } catch { /* quota */ }
  version++;
  subs.forEach((f) => f());
  return true;
}

/** Select by roster position (0-based). Used by the Opt+Cmd+1..9 shortcuts. */
export function selectCharacterByIndex(i: number): string | null {
  const c = DREADROOT_CHARACTERS[i];
  if (!c) return null;
  setSelectedCharacter(c.name);
  return c.name;
}

export function useSelectedCharacter(): string {
  useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => version,
    () => version,
  );
  return selected;
}
