// siegeLighting — preview lighting style for Siege worlds, toggled from the Admin/Weather panel.
// 'default' = the world's own lighting; 'night' = the CyberCity-style dark mood (NightDimmer:
// dims the shared sun/hemi/ambient + cool dark fog). Lets us see any world in night lighting.
import { useSyncExternalStore } from 'react';

export type SiegeLightingMode = 'default' | 'night';
let mode: SiegeLightingMode = 'default';
const subs = new Set<() => void>();
export const getSiegeLighting = (): SiegeLightingMode => mode;
export const setSiegeLighting = (m: SiegeLightingMode): void => { if (m === mode) return; mode = m; subs.forEach((f) => f()); };
export function useSiegeLighting(): SiegeLightingMode {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getSiegeLighting, getSiegeLighting);
}
