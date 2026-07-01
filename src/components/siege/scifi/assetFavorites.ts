// assetFavorites — the "staging area" for the asset browser. A small localStorage-backed list of
// assets the user starred while browsing the grids or via the code lookup, so they collect in the
// builder panel ready to drop into a scene. Keyed by the asset's stable code (see assetCode.ts).
import { useSyncExternalStore } from 'react';

export interface FavAsset { code: string; set: string; file: string; name: string; }

const LS = 'sw_asset_favorites_v1';
let favs: FavAsset[] = load();
const subs = new Set<() => void>();
const emit = () => { subs.forEach((f) => f()); };

function load(): FavAsset[] {
  try { const v = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function persist(): void { try { localStorage.setItem(LS, JSON.stringify(favs)); } catch { /* ignore */ } }

export function getFavorites(): FavAsset[] { return favs; }
export function isFavorite(code: string): boolean { return favs.some((f) => f.code === code); }
export function addFavorite(f: FavAsset): void {
  if (favs.some((x) => x.code === f.code)) return;
  favs = [...favs, f]; persist(); emit();
}
export function removeFavorite(code: string): void {
  favs = favs.filter((f) => f.code !== code); persist(); emit();
}
export function toggleFavorite(f: FavAsset): void {
  if (isFavorite(f.code)) removeFavorite(f.code); else addFavorite(f);
}
export function useFavorites(): FavAsset[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getFavorites, getFavorites);
}
