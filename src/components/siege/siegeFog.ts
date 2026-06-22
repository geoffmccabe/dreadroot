// siegeFog — a tiny on/off switch for the Bleakrock horror fog + scrim, so it can be turned off
// from the Admin/Weather panel (e.g. to fly out and inspect distant objects). Default ON.
import { useSyncExternalStore } from 'react';

let fogOn = true;
const subs = new Set<() => void>();
export const getSiegeFog = (): boolean => fogOn;
export const setSiegeFog = (v: boolean): void => { if (v === fogOn) return; fogOn = v; subs.forEach((f) => f()); };
export function useSiegeFog(): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getSiegeFog, getSiegeFog);
}
