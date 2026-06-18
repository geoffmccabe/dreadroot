// challengeBrowserStore — open/closed state for the Challenge Browser (the player-facing list of
// playable challenges for the active game). Opened from the start modal's "Challenge" choice, the
// "!b" command, or a HUD button.
let open = false;
const listeners = new Set<() => void>();
export function isBrowserOpen() { return open; }
export function subscribeBrowser(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function setBrowserOpen(v: boolean) { open = v; listeners.forEach((l) => l()); }
export function toggleBrowser() { setBrowserOpen(!open); }
