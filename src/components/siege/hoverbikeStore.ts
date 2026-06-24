// Tiny store: is the player within range of the hoverbike? The in-Canvas Hoverbike writes it each
// frame; the HUD HoverbikePrompt reads it to show the "Requires Keycard" prompt.
let inRange = false;
const listeners = new Set<() => void>();

export function setHoverbikeInRange(v: boolean): void {
  if (v === inRange) return;
  inRange = v;
  listeners.forEach((l) => l());
}
export function getHoverbikeInRange(): boolean { return inRange; }
export function subscribeHoverbike(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
