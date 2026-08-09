// kaijuPanelLayout — one place that decides where the three Kaiju panels sit.
//
// Geoff: "put it defaulting to be just above the Kaiju Tracker panel. Make it the same width as the
// current Kaiju Tracker Panel. Put the Tell your Kaiju panel just on top of that so all three are
// lined up."
//
// THREE PANELS THAT MUST AGREE, so the numbers live in one file rather than three. Before this each
// panel carried its own width and its own starting top, which is why they were 320, 268 and 340 wide
// and overlapped: nothing anywhere knew that the other two existed. A shared column means changing
// the width once moves all three, and the gaps stay right.
//
// The panels are still DRAGGABLE. This only decides where they open.
//
// Order down the screen, which is the order you use them in: say something to your Kaiju, check what
// it is, then watch what it does.
//
//     Talk to Kaiju      <- top
//     Mini Earth - Kaiju Lab
//     Kaiju tracker      <- bottom, the tallest, and the one with the map

/** One width for the column. The tracker's, since it was the widest and needs the map. */
export const PANEL_W = 340;

/**
 * Height caps, in pixels.
 *
 * These are CAPS with scrolling, not fixed heights: a panel shorter than its cap simply ends, and
 * the next one down does not move up to meet it. That is deliberate — a column whose items jump
 * around as their contents change is harder to use than one with a little empty space in it.
 */
export const TALK_MAX_H = 150;
/** "make it 25% of the current vertical height" — it ran to roughly 680 px of diagnostics. */
export const LAB_MAX_H = 170;

/** Gap between panels. */
const GAP = 8;

/** The tracker keeps its original starting position; the other two are placed relative to it. */
export const TRACKER_TOP = 430;
export const LAB_TOP = TRACKER_TOP - LAB_MAX_H - GAP;
export const TALK_TOP = LAB_TOP - TALK_MAX_H - GAP;

/**
 * Starting x for the column, docked to the RIGHT edge.
 *
 * The Kaiju panels used to open on the left, where they formed a second column on top of the game's
 * own HUD and covered the view. Falls back to a sane left position if there is no window (SSR) or
 * the screen is narrow.
 */
export function panelLeft(margin = 16): number {
  if (typeof window === 'undefined') return margin;
  return Math.max(margin, window.innerWidth - PANEL_W - margin);
}

/** The shared chrome, so the three panels cannot drift apart visually either. */
export function panelStyle(left: number, top: number, zIndex: number, maxHeight?: number | string): React.CSSProperties {
  return {
    position: 'fixed', left, top, width: PANEL_W,
    ...(maxHeight ? { maxHeight, overflowY: 'auto' as const } : null),
    color: 'var(--pt-debug-body-color)', font: 'var(--pt-debug-body-size) var(--pt-debug-body-family)',
    background: 'var(--pt-debug-bg)', border: 'var(--pt-debug-border-w) solid var(--pt-debug-border)',
    borderRadius: 'var(--pt-debug-radius)', padding: '8px 10px', pointerEvents: 'auto',
    boxShadow: '0 2px 10px rgba(0,0,0,0.5)', zIndex,
  };
}

/**
 * A colour per Kaiju, used by BOTH the tracker's tabs and the dots on the minimap.
 *
 * Shared on purpose: a dot on the map is only useful if you can tell which creature it is without
 * reading anything, and that only works while the tab and the dot are the same colour. Two separate
 * lists would drift the first time one of them was reordered.
 */
export const KAIJU_COLOURS = ['#6fa8ff', '#e05a4a', '#5fd35f', '#e0c04a', '#c77dff', '#4ad8d8'];

export function kaijuColour(i: number): string {
  return KAIJU_COLOURS[i % KAIJU_COLOURS.length];
}
