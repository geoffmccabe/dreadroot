// siegeLobbyZones — proximity trigger points in the Siege lobby (the SWW world). A small store
// the in-Canvas watcher updates each frame; the HUD reads it for prompts and FortressControls
// reads it imperatively to gate the V key. Vault and Market are ~18m apart and never overlap, so
// the single V key opens whichever zone the player is standing in. The Forge zone auto-opens its
// panel on enter (no key) and closes on leave.
import { useSyncExternalStore } from 'react';

export interface LobbyZone { id: 'vault' | 'market' | 'forge'; x: number; z: number; r: number; }
// Engine-space points + radii from the user's laser readout.
// TODO(forge-coords): replace the forge x/z below with the real laser readout for the lobby
// forge. Placeholder for now (offset from market) so the zone exists but won't trigger at the
// right spot until the true coordinates are dropped in.
export const SIEGE_LOBBY_ZONES: LobbyZone[] = [
  { id: 'vault',  x: -90.335, z: 308.073, r: 4 },
  { id: 'market', x: -83.886, z: 325.554, r: 3 },
  { id: 'forge',  x: -77.000, z: 315.000, r: 3 },
];

let vaultInRange = false;
let marketInRange = false;
let forgeInRange = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getVaultInRange = (): boolean => vaultInRange;
export const getMarketInRange = (): boolean => marketInRange;
export const getForgeInRange = (): boolean => forgeInRange;

export function setLobbyRanges(v: boolean, m: boolean, f: boolean): void {
  if (v === vaultInRange && m === marketInRange && f === forgeInRange) return;
  vaultInRange = v; marketInRange = m; forgeInRange = f; emit();
}
// Horizontal (x,z) distance test — forgiving for "walk up to it" triggers.
export function rangesAt(x: number, z: number): { v: boolean; m: boolean; f: boolean } {
  let v = false, m = false, f = false;
  for (const zn of SIEGE_LOBBY_ZONES) {
    const dx = x - zn.x, dz = z - zn.z;
    const inside = dx * dx + dz * dz < zn.r * zn.r;
    if (zn.id === 'vault') v = inside;
    else if (zn.id === 'market') m = inside;
    else f = inside;
  }
  return { v, m, f };
}

const snap = () => (vaultInRange ? 1 : 0) | (marketInRange ? 2 : 0) | (forgeInRange ? 4 : 0);
export function useSiegeLobbyZones(): { vaultInRange: boolean; marketInRange: boolean; forgeInRange: boolean } {
  const s = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, snap, snap);
  return { vaultInRange: !!(s & 1), marketInRange: !!(s & 2), forgeInRange: !!(s & 4) };
}
