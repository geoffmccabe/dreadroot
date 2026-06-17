// Tiny store so the in-Canvas SiegeTeleport (which owns the camera + keys) can
// tell the out-of-Canvas SiegeTeleportMenu (styled, game CSS) when to show.
let armed = false;
const listeners = new Set<() => void>();

export function isTeleportArmed(): boolean { return armed; }
export function setTeleportArmed(v: boolean): void {
  if (armed === v) return;
  armed = v;
  listeners.forEach((l) => l());
}
export function subscribeTeleport(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
