// mapLoadStatus — a tiny store bridging the in-Canvas map load (SiegeWorldLayers) to the DOM load
// modal (MapLoadModal), so a Cmd-J map switch shows "Loading Terrain" → "Loading Objects" while it
// streams in. null = nothing loading (hide the modal).
import { useSyncExternalStore } from 'react';

let msg: string | null = null;
const subs = new Set<() => void>();
export const getMapLoadStatus = () => msg;
export function setMapLoadStatus(m: string | null): void {
  if (msg === m) return;
  msg = m;
  subs.forEach((f) => f());
}
export function useMapLoadStatus(): string | null {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getMapLoadStatus, getMapLoadStatus);
}
