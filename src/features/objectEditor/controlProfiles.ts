// Control profiles — the user-selectable "feel" of the Arrange tool. All three drive the
// SAME interaction model (grab-and-carry on the height plane, wheel for raise/rotate/scale,
// Ctrl to ride the surface below). They differ only in DEFAULTS: how chunky the grid snap is
// and how big each wheel step is. That's the honest difference between Roblox-style (forgiving,
// snappy) and Unity-style (fine, precise) — so a "preset" here is a small settings object, not
// a second input engine. Persisted per-browser so the choice sticks.
//
// Adding a profile = add one entry to PROFILES. Nothing else changes.

export interface ControlProfile {
  name: string;
  blurb: string;
  gridSnap: number;    // metres; 0 = free placement (no XZ grid snap)
  heightStep: number;  // metres per wheel notch (raise / lower)
  rotateStep: number;  // radians per Shift+wheel notch (yaw)
  scaleStep: number;   // multiply per Option+wheel notch (>1)
}

const D = Math.PI / 180;

export const PROFILES: Record<string, ControlProfile> = {
  // Our default — free placement, gentle steps. Precision without fuss.
  standard: { name: 'Standard', blurb: 'Free placement, gentle steps', gridSnap: 0, heightStep: 0.5, rotateStep: 15 * D, scaleStep: 1.1 },
  // Roblox-style — chunky stud grid + big 45° turns. Forgiving, "it just snaps into place".
  roblox: { name: 'Roblox', blurb: 'Chunky grid, 45° turns — forgiving', gridSnap: 1, heightStep: 1, rotateStep: 45 * D, scaleStep: 1.25 },
  // Unity-style — fine quarter-metre grid + small steps. Precision-first.
  unity: { name: 'Unity', blurb: 'Fine grid, small steps — precise', gridSnap: 0.25, heightStep: 0.25, rotateStep: 15 * D, scaleStep: 1.1 },
};

export const PROFILE_KEYS = Object.keys(PROFILES);

const LS_KEY = 'sw_ctrl_profile';
let activeKey = (() => {
  try { const k = localStorage.getItem(LS_KEY); if (k && PROFILES[k]) return k; } catch { /* ignore */ }
  return 'standard';
})();

const subs = new Set<() => void>();
export function subscribeProfile(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }

export function getProfileKey(): string { return activeKey; }
export function getProfile(): ControlProfile { return PROFILES[activeKey]; }
export function setProfileKey(k: string): void {
  if (!PROFILES[k] || k === activeKey) return;
  activeKey = k;
  try { localStorage.setItem(LS_KEY, k); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

// Snap a single axis value to the active grid (no-op when gridSnap is 0).
export function snapAxis(v: number): number {
  const g = PROFILES[activeKey].gridSnap;
  return g > 0 ? Math.round(v / g) * g : v;
}
