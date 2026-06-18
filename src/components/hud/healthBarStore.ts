// healthBarStore — a tiny global pulse store for the brief on-screen health bar that
// appears whenever the player is hit (or drinks a healing potion). Game-agnostic: the
// shared damage pipeline (usePlayerHealth.takeDamageInternal) pulses it, so it works in
// Dreadroot, Siege Worlds, Pinkland, and any future game with no per-game wiring.
let state = { current: 0, max: 1, shownAt: -1 };
const subs = new Set<() => void>();

/** Show the health bar now with the given current/max HP. Call on damage or potion heal. */
export function pulseHealthBar(current: number, max: number): void {
  state = { current, max: Math.max(1, max), shownAt: performance.now() };
  subs.forEach((f) => f());
}
export function getHealthBarState() { return state; }
export function subscribeHealthBar(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }
