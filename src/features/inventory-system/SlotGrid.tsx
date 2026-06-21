// Generic positional slot grid. Renders any region (vault page, inv,
// QS) using the same DOM + interaction layer. NO HTML5 drag/drop —
// every interaction is pointerdown / contextmenu, dispatched through
// the slotClick reducer.
//
// Click semantics (Minecraft canonical):
//   - left-click       → slotClick(button: 'left')   — pickup / drop / merge / swap
//   - right-click      → slotClick(button: 'right')  — take half / drop one
//   - shift+left-click → slotClick(button: 'left', shift: true) — instant-transfer
//   - double-click     → slotClick(doubleClick: true)
//
// Detail modal is opened by HOVERING the top-right corner for >1s
// and clicking the "?" that appears (no longer right-click).

import React from 'react';
import type { SlotLocation, SlotOccupant, SlotClickInput } from './types';
import { useCursorStack, cursorStackApi } from './useCursorStack';
import { ItemTileVisual } from './ItemTileVisual';

const TILE = 56;
const GAP = 6;
const HELP_HOVER_DELAY_MS = 1000;
// Pointer travel (squared px) past which a press counts as a DRAG rather
// than a discrete click. Matches the hotbar's threshold.
const DRAG_THRESHOLD_SQ = 36; // 6px²

export interface SlotGridProps {
  rows: number;
  cols: number;
  /** map slotIndex (1..rows*cols) → occupant (or null if empty) */
  occupants: Map<number, SlotOccupant>;
  /** Build the SlotLocation for a given slotIndex. */
  locationOf: (slotIndex: number) => SlotLocation;
  /** Called for every click on every slot. */
  onSlotClick: (input: SlotClickInput) => void;
  /** Called when the user clicks the "?" badge that appears after
   *  hovering the top-right corner of an occupied slot for >1s.
   *  This is the only way to open the item-detail modal. */
  onSlotInspect?: (occupant: SlotOccupant) => void;
  /** Optional: highlight a particular slot (e.g. equipped indicator). */
  highlightSlot?: number;
  /** Optional: dim a slot (e.g. ghosted while on cursor). */
  isSlotGhosted?: (slotIndex: number) => boolean;
}

export function SlotGrid({
  rows, cols, occupants, locationOf, onSlotClick, onSlotInspect, highlightSlot, isSlotGhosted,
}: SlotGridProps) {
  const totalSlots = rows * cols;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${TILE}px)`,
        gap: `${GAP}px`,
      }}
    >
      {Array.from({ length: totalSlots }, (_, i) => {
        const slotIdx = i + 1;
        const occ = occupants.get(slotIdx);
        const ghosted = isSlotGhosted?.(slotIdx) ?? false;
        const highlight = slotIdx === highlightSlot;
        return (
          <SlotTile
            key={slotIdx}
            slotIndex={slotIdx}
            occupant={occ}
            ghosted={ghosted}
            highlight={highlight}
            // Inventory taps only COUNT (never pick up), so report every click regardless of
            // detail; other regions keep the detail>=2 skip so a double-click's pickup doesn't
            // fight the double-click handler.
            tapCountsOnly={locationOf(slotIdx).region === 'inventory'}
            onInspect={onSlotInspect}
            onClick={(button, shift, doubleClick, intent) => onSlotClick({
              location: locationOf(slotIdx),
              occupant: occ ?? null,
              button,
              shift,
              doubleClick,
              intent,
            })}
          />
        );
      })}
    </div>
  );
}

// ── SlotTile ──────────────────────────────────────────────────────
interface SlotTileProps {
  slotIndex: number;
  occupant: SlotOccupant | undefined;
  ghosted: boolean;
  highlight: boolean;
  /** When true (inventory), a plain tap only counts toward triple-click — it never picks
   *  up — so we report every click (no detail>=2 skip) for reliable triple-click counting. */
  tapCountsOnly?: boolean;
  onClick: (button: 'left' | 'right', shift: boolean, doubleClick: boolean, intent?: 'drag' | 'tap') => void;
  onInspect?: (occupant: SlotOccupant) => void;
}

function SlotTile({ slotIndex, occupant, ghosted, highlight, tapCountsOnly, onClick, onInspect }: SlotTileProps) {
  const cursor = useCursorStack((s) => s.cursor);
  const cursorActive = cursor !== null;
  const [isHovered, setIsHovered] = React.useState(false);
  // Tracks the in-flight press so we can tell a discrete click from a
  // drag. Pickup now happens on drag-start (pointermove) or on a
  // discrete release (pointerup), NOT on pointerdown — otherwise a
  // single click would pick up on down and immediately return on the
  // same-tile up. Drops/returns stay on the per-tile onPointerUp below,
  // which intentionally reads the STALE closure `cursor`: within one
  // event tick a just-completed pickup hasn't re-rendered, so the tile
  // won't also fire a drop; across a real drag React has re-rendered,
  // so the release tile drops correctly.
  const pressRef = React.useRef<{ x: number; y: number; cursorWasHeld: boolean; didDrag: boolean } | null>(null);
  // Tears down the in-flight document listeners. Held in a ref so an
  // unmount mid-press (panel closes, ESC) can run it — otherwise the
  // pointermove/up/cancel listeners would leak and keep firing.
  const cleanupRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => { cleanupRef.current?.(); }, []);

  // Drop-target highlight: when cursor is held and the mouse hovers
  // a slot, the slot gets a green outline + tint if it would accept
  // the drop. Source slot ALSO accepts (for cancel/return); empty
  // and same-stackable-item slots accept (would merge in vault).
  // Different-item slots: no highlight.
  const wouldAcceptDrop =
    cursorActive && isHovered &&
    (ghosted
      || !occupant
      || (occupant.itemId === cursor!.itemId && !occupant.nonStackable));

  return (
    <div
      onPointerDown={(e) => {
        if (e.button === 2) { onClick('right', e.shiftKey, false); return; }
        if (e.button !== 0) return;
        // Shift = instant-transfer to the opposite region; no cursor gesture.
        if (e.shiftKey) { onClick('left', true, false); return; }
        const cursorWasHeld = cursorStackApi.getCursor() !== null;
        pressRef.current = { x: e.clientX, y: e.clientY, cursorWasHeld, didDrag: false };
        const cleanup = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onCancel);
          cleanupRef.current = null;
        };
        const onMove = (ev: PointerEvent) => {
          const p = pressRef.current;
          if (!p || p.didDrag) return;
          const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
          if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
            p.didDrag = true;
            // Drag begun on an empty cursor → lift this tile's item onto
            // the cursor so it rides the drag; the release tile's
            // onPointerUp performs the drop. intent='drag' → this is the ONLY
            // way a plain (non-shift) interaction picks an item up.
            if (!p.cursorWasHeld && occupant) onClick('left', ev.shiftKey, false, 'drag');
          }
        };
        const onCancel = () => { pressRef.current = null; cleanup(); };
        const onUp = (ev: PointerEvent) => {
          cleanup();
          const p = pressRef.current;
          pressRef.current = null;
          if (!p || ev.button !== 0) return;
          if (p.didDrag) return; // drag drop handled by the release tile's onPointerUp
          // Skip the clicks of a double-click (detail>=2) ONLY where a tap would pick up
          // (vault) — so it doesn't fight the double-click handler. Inventory taps merely
          // COUNT toward triple-click, so we must report every one (else fast triple-clicks
          // never reach 3).
          if (!tapCountsOnly && ev.detail >= 2) return;
          // Discrete click with no drag → a plain TAP. It must NEVER pick the item up
          // (only drag moves). Report it as intent='tap' so the reducer just counts it
          // toward triple-click-to-equip; nothing is lifted onto the cursor.
          if (!p.cursorWasHeld && cursorStackApi.getCursor() === null && occupant) {
            onClick('left', ev.shiftKey, false, 'tap');
          }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onCancel);
        cleanupRef.current = cleanup;
      }}
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        console.log('[DR-DBG] inv tile pointerUp slot', slotIndex, 'reactCursor', cursor?.origin, 'liveCursor', cursorStackApi.getCursor()?.origin);
        // Stale closure `cursor` on purpose (see pressRef note above):
        // a same-tick pickup hasn't re-rendered, so we won't double-fire.
        if (!cursor) return;
        if (ghosted) {
          // Release on the SOURCE tile → return the item. Cursor
          // never touched the DB, so clearing the cursor reverts the
          // visual state instantly.
          cursorStackApi.setCursor(null);
          return;
        }
        // Cursor held + released on a different tile = drop / swap.
        onClick('left', e.shiftKey, false);
      }}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onContextMenu={(e) => { e.preventDefault(); }}
      onDoubleClick={(e) => {
        onClick('left', e.shiftKey, true);
      }}
      style={{
        width: TILE,
        height: TILE,
        borderRadius: 'var(--hud-radius, 4px)',
        border: wouldAcceptDrop
          ? '2px solid hsla(120, 100%, 60%, 0.95)'
          : highlight
            ? '1px solid hsla(45, 100%, 60%, 0.9)'
            : '1px solid hsla(var(--hud-border, 0 0% 100% / 0.3))',
        background: wouldAcceptDrop
          ? 'hsla(120, 60%, 25%, 0.35)'
          : 'hsla(var(--hud-bg-dim, 0 0% 0% / 0.4))',
        backdropFilter: 'blur(8px) saturate(140%)',
        WebkitBackdropFilter: 'blur(8px) saturate(140%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
        cursor: cursorActive ? 'pointer' : (occupant ? 'pointer' : 'default'),
        opacity: ghosted ? 0.2 : 1,
        userSelect: 'none',
      }}
    >
      <ItemTileVisual occupant={occupant ?? null} />
      {occupant && onInspect && !ghosted && (
        <HelpCornerOverlay onActivate={() => onInspect(occupant)} />
      )}
    </div>
  );
}

// ── HelpCornerOverlay ─────────────────────────────────────────────
// A small invisible 16×16 capture region at the slot's top-right.
// Hovering it for >1s reveals a "?" badge styled identically to the
// tier + quantity badges. Clicking the "?" opens the detail modal.
//
// Right-click is now reserved for "take half" (Minecraft canonical)
// — this overlay is the new path to the detail modal.
export function HelpCornerOverlay({ onActivate }: { onActivate: () => void }) {
  const [showHelp, setShowHelp] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return (
    <div
      onPointerEnter={() => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setShowHelp(true), HELP_HOVER_DELAY_MS);
      }}
      onPointerLeave={() => {
        if (timerRef.current) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setShowHelp(false);
      }}
      onPointerDown={(e) => {
        // Once the "?" is showing, intercept the click so it doesn't
        // bubble to the slot's pickup handler.
        if (showHelp) {
          e.stopPropagation();
          onActivate();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 16,
        height: 16,
        // Transparent capture region — only the "?" badge is visible.
        background: 'transparent',
        cursor: showHelp ? 'help' : 'inherit',
        zIndex: 3,
      }}
    >
      {showHelp && (
        <span style={{
          position: 'absolute',
          top: 2,
          right: 4,
          fontSize: 8,
          fontWeight: 700,
          color: 'white',
          fontFamily: 'var(--hud-font)',
          lineHeight: 1,
          textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.9)',
          pointerEvents: 'none',
        }}>
          ?
        </span>
      )}
    </div>
  );
}
