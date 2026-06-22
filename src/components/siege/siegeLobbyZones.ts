// siegeLobbyZones — proximity trigger points in the Siege lobby (the SWW world). A small store
// the in-Canvas watcher updates each frame; the HUD reads it for prompts and FortressControls
// reads it imperatively to gate the V key. Vault/Market/Forge open their UIs; the Portal zone
// opens the !c challenge browser on enter. Zones don't overlap, so V is unambiguous.
import { useSyncExternalStore } from 'react';

export interface LobbyZone { id: 'vault' | 'market' | 'forge' | 'portal' | 'chest'; x: number; z: number; r: number; }
// Engine-space centers + radii (from laser readouts).
export const SIEGE_LOBBY_ZONES: LobbyZone[] = [
  { id: 'vault',  x: -78.563,  z: 316.169, r: 4 },
  { id: 'market', x: -86.810,  z: 324.463, r: 1.5 },  // 3 m diameter
  { id: 'forge',  x: -101.818, z: 325.421, r: 3 },    // 6 m diameter
  { id: 'portal', x: -91.370,  z: 299.593, r: 0.75 }, // 1.5m diameter → !c menu (closes on leave)
  { id: 'chest',  x: -84.749,  z: 309.726, r: 1 },    // Magic Chest (under the tree)
];

let vaultInRange = false, marketInRange = false, forgeInRange = false, portalInRange = false, chestInRange = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getVaultInRange = (): boolean => vaultInRange;
export const getMarketInRange = (): boolean => marketInRange;
export const getForgeInRange = (): boolean => forgeInRange;
export const getPortalInRange = (): boolean => portalInRange;
export const getChestInRange = (): boolean => chestInRange;

export function setLobbyRanges(v: boolean, m: boolean, f: boolean, p: boolean, c: boolean): void {
  if (v === vaultInRange && m === marketInRange && f === forgeInRange && p === portalInRange && c === chestInRange) return;
  vaultInRange = v; marketInRange = m; forgeInRange = f; portalInRange = p; chestInRange = c; emit();
}
// Horizontal (x,z) distance test — forgiving for "walk up to it" triggers.
export function rangesAt(x: number, z: number): { v: boolean; m: boolean; f: boolean; p: boolean; c: boolean } {
  let v = false, m = false, f = false, p = false, c = false;
  for (const zn of SIEGE_LOBBY_ZONES) {
    const dx = x - zn.x, dz = z - zn.z;
    const inside = dx * dx + dz * dz < zn.r * zn.r;
    if (zn.id === 'vault') v = inside;
    else if (zn.id === 'market') m = inside;
    else if (zn.id === 'forge') f = inside;
    else if (zn.id === 'portal') p = inside;
    else c = inside;
  }
  return { v, m, f, p, c };
}

const snap = () => (vaultInRange ? 1 : 0) | (marketInRange ? 2 : 0) | (forgeInRange ? 4 : 0) | (portalInRange ? 8 : 0) | (chestInRange ? 16 : 0);
export function useSiegeLobbyZones(): { vaultInRange: boolean; marketInRange: boolean; forgeInRange: boolean; portalInRange: boolean; chestInRange: boolean } {
  const s = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, snap, snap);
  return { vaultInRange: !!(s & 1), marketInRange: !!(s & 2), forgeInRange: !!(s & 4), portalInRange: !!(s & 8), chestInRange: !!(s & 16) };
}
