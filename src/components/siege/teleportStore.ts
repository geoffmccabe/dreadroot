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

// Imperative teleport bridge: SiegeTeleport (in-Canvas, owns the camera) installs
// window.__siegeJump; any out-of-Canvas UI (the Cmd-J menu, the Challenges → Worlds
// cards) calls this to jump to a map + position.
export function siegeJump(mapId: string, pos: [number, number, number], yaw?: number, pitch?: number): void {
  (window as unknown as {
    __siegeJump?: (m: string, p: [number, number, number], y?: number, pi?: number) => void;
  }).__siegeJump?.(mapId, pos, yaw, pitch);
}
