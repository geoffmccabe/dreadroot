// challengeCreatorStore — open/closed state for the Challenge Creator panel (toggled by "!e").
let open = false;
const listeners = new Set<() => void>();
export function isCreatorOpen() { return open; }
export function subscribeCreator(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function setCreatorOpen(v: boolean) { open = v; listeners.forEach((l) => l()); }
export function toggleCreator() { setCreatorOpen(!open); }
