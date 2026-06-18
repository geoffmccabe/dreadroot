// fovSetting — user-controlled camera field-of-view (degrees), persisted per-device in
// localStorage. FirstPersonArms reads getBaseFov() each frame as the "hip" FoV and zooms
// to base-25 when aiming. A narrower FoV reduces the wide-angle stretch that makes nearby
// enemies look farther than they are (the "it hit me but looked too far" feeling).
import { useSyncExternalStore } from 'react';

const KEY = 'dr_base_fov';
export const FOV_MIN = 55;
export const FOV_MAX = 100;
export const FOV_DEFAULT = 75;

function load(): number {
  try {
    const v = parseFloat(localStorage.getItem(KEY) || '');
    if (Number.isFinite(v) && v >= FOV_MIN && v <= FOV_MAX) return v;
  } catch { /* ignore */ }
  return FOV_DEFAULT;
}

let fov = load();
const subs = new Set<() => void>();

export function getBaseFov(): number { return fov; }
export function setBaseFov(v: number): void {
  fov = Math.max(FOV_MIN, Math.min(FOV_MAX, Math.round(v)));
  try { localStorage.setItem(KEY, String(fov)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export function subscribeFov(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }
export function useBaseFov(): number { return useSyncExternalStore(subscribeFov, getBaseFov, getBaseFov); }
