// Are we running inside someone else's page? Today that means the Alien Worlds wallet, which
// frames the game fullscreen and puts its own "✕ Close" button in the TOP-RIGHT corner — exactly
// where the engine's own top-right controls live, completely covering them.
//
// The host owns its chrome, so the game moves out of the way rather than fighting it. Everything
// the engine pins to the top-right offsets downward by EMBED_TOP_OFFSET when framed.
export function isEmbedded(): boolean {
  try { return window.parent !== window; } catch { return true; }  // cross-origin throw = framed
}

/** Vertical clearance for a host's own top-right chrome. */
export const EMBED_TOP_OFFSET = 52;

/** Top offset (px) for anything pinned top-right, clearing the host's controls when framed. */
export function topRightY(base = 8): number {
  return isEmbedded() ? base + EMBED_TOP_OFFSET : base;
}
