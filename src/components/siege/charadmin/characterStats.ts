// characterStats — the 6 Siege Worlds playable characters + their editable admin stats. Stats default
// to 100 and persist in localStorage (modifiable by the admin now; later they'll drive in-game
// modifiers — making each character better/worse at each thing). Special abilities are freeform for
// now. Mirrors the Enemies-SW admin pattern but client-stored (no Supabase table yet).
import { useSyncExternalStore } from 'react';
import { CHAR_ASSET_VERSION } from '../charlineup/siegeCharLineupState';

export const CHAR_STAT_FIELDS: { key: string; label: string }[] = [
  { key: 'height', label: 'Height' },
  { key: 'health', label: 'Health' },
  { key: 'speed', label: 'Speed' },
  { key: 'healing', label: 'Healing' },
  { key: 'glide', label: 'Glide' },
  { key: 'stealth', label: 'Stealth' },
  { key: 'damage', label: 'Damage' },
  { key: 'throw', label: 'Throw' },
  { key: 'aim', label: 'Aim' },
];

export interface CharacterDef { name: string; file: string; rawH: number }
// The lineup's 6 characters, ALPHABETICAL. rawH = glb model height (for preview normalization).
export const CHARACTERS: CharacterDef[] = [
  { name: 'Ash',     file: '/siege/characters/pilot_ash.glb',     rawH: 1.7906 },
  { name: 'Dago',    file: '/siege/characters/pilot_dago.glb',    rawH: 1.6946 },
  { name: 'Fluffer', file: '/siege/characters/pilot_fluffer.glb', rawH: 2.0355 },
  { name: 'Jankz',   file: '/siege/characters/pilot_jankz.glb',   rawH: 1.7106 },
  { name: 'Rajax',   file: '/siege/characters/pilot_rajax.glb',   rawH: 1.9260 },
  { name: 'Thorn',   file: '/siege/characters/pilot_thorn.glb',   rawH: 1.7598 },
];

export interface CharData { stats: Record<string, number>; abilities: string[] }
const defaultStats = (): Record<string, number> =>
  Object.fromEntries(CHAR_STAT_FIELDS.map((f) => [f.key, 100]));

const LS_KEY = 'sw_character_stats_v1';
type Store = Record<string, { stats?: Record<string, number>; abilities?: string[] }>;
let store: Store = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } })();

let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* ignore quota */ }
  subs.forEach((f) => f());
};

// Merge saved partials over the defaults so new stat fields always appear at 100.
export function getCharData(name: string): CharData {
  const d = store[name] || {};
  return { stats: { ...defaultStats(), ...(d.stats || {}) }, abilities: d.abilities ? [...d.abilities] : [] };
}
export function setCharStat(name: string, key: string, value: number): void {
  const d = store[name] || {};
  store[name] = { stats: { ...(d.stats || {}), [key]: value }, abilities: d.abilities || [] };
  emit();
}
export function setCharAbilities(name: string, abilities: string[]): void {
  const d = store[name] || {};
  store[name] = { stats: d.stats || {}, abilities };
  emit();
}
export function resetChar(name: string): void { delete store[name]; emit(); }

// Subscribe a component to stat/ability changes (returns a changing version number).
export function useCharacterData(): number {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => version, () => version,
  );
}

export const charGlbUrl = (file: string): string => `${file}?a=${CHAR_ASSET_VERSION}`;
