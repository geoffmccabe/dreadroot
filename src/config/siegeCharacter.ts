// Siege Worlds playable-character selection. Cosmetic skins on a shared 48-bone rig (the
// PlayerSkins.fbx export), animated by one shared clip set (_animations.glb). The local player
// picks a skin; it renders as their avatar (hidden in first person, shown in the inspect view).
import { useSyncExternalStore } from 'react';

export interface SiegeCharacter { id: string; name: string }

// Starter roster (converted from PlayerSkins.fbx on the shared Root rig). Grows as more are baked.
export const SIEGE_CHARACTERS: SiegeCharacter[] = [
  { id: 'knight', name: 'Knight' },
  { id: 'queen', name: 'Queen' },
  { id: 'druid', name: 'Druid' },
  { id: 'angus', name: 'Angus' },
  { id: 'ragnar', name: 'Ragnar' },
  { id: 'zap', name: 'Zap' },
  { id: 'bonnie', name: 'Bonnie' },
  { id: 'ladyhao', name: 'Lady Hao' },
  // Known-good STATIC conversions (own rigs, coherent render, no anim clips yet).
  { id: 'shiyang', name: 'Shi Yang' },
  { id: 'thorn', name: 'Thorn' },
  { id: 'nakano', name: 'Nakano' },
];

const LS_KEY = 'sw_character';
let selected = (() => {
  try { const s = localStorage.getItem(LS_KEY); if (s && SIEGE_CHARACTERS.some((c) => c.id === s)) return s; } catch { /* ignore */ }
  return SIEGE_CHARACTERS[0].id;
})();
let inspect = true;   // DIAGNOSTIC: default ON so the character + panel show without Ctrl/Cmd+V
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function getSelectedCharacter(): string { return selected; }
export function setSelectedCharacter(id: string): void {
  if (id === selected) return;
  selected = id;
  try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
  emit();
}
export function isInspectView(): boolean { return inspect; }
export function setInspectView(on: boolean): void { if (on !== inspect) { inspect = on; emit(); } }

// ── Animation-panel bridge ──
// CharacterRig lives inside the R3F Canvas (can't render DOM), so it PUBLISHES its clip
// list + play() here; the DOM panel (SiegeAnimPanel, in the normal React tree) consumes it
// and renders in the game's CSS. Keeps the 3D code and the styled panel decoupled.
export interface SiegeAnimState { names: string[]; current: string; play: (n: string) => void }
let animState: SiegeAnimState = { names: [], current: '', play: () => {} };
const animSubs = new Set<() => void>();
export function publishAnim(s: SiegeAnimState): void { animState = s; animSubs.forEach((f) => f()); }
export function useSiegeAnim(): SiegeAnimState {
  return useSyncExternalStore((cb) => { animSubs.add(cb); return () => animSubs.delete(cb); }, () => animState);
}

function subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); }
/** React hook → re-renders on character OR inspect change; returns {selected, inspect}. */
export function useSiegeCharacter() {
  return useSyncExternalStore(subscribe, () => selected + '|' + inspect);
}
