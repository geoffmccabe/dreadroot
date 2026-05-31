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

export interface SlotGridProps {
  rows: number;
  cols: number;
  /** map slotIndex (0..rows*cols-1) → occupant (or null if empty) */
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
        const occ = occupants.get(i);
        const ghosted = isSlotGhosted?.(i) ?? false;
        const highlight = i === highlightSlot;
        return (
          <SlotTile
            key={i}
            slotIndex={i}
            occupant={occ}
            ghosted={ghosted}
            highlight={highlight}
            onInspect={onSlotInspect}
            onClick={(button, shift, doubleClick) => onSlotClick({
              location: locationOf(i),
              occupant: occ ?? null,
              button,
              shift,
              doubleClick,
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
  onClick: (button: 'left' | 'right', shift: boolean, doubleClick: boolean) => void;
  onInspect?: (occupant: SlotOccupant) => void;
}

function SlotTile({ slotIndex, occupant, ghosted, highlight, onClick, onInspect }: SlotTileProps) {
  const cursor = useCursorStack((s) => s.cursor);
  const cursorActive = cursor !== null;
  const [isHovered, setIsHovered] = React.useState(false);

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
        if (e.button === 0) onClick('left', e.shiftKey, false);
        else if (e.button === 2) onClick('right', e.shiftKey, false);
      }}
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        if (!cursor) return;
        if (ghosted) {
          // Release on the SOURCE tile → return the item. Cursor
          // never touched the DB, so clearing the cursor reverts the
          // visual state instantly.
          cursorStackApi.setCursor(null);
          return;
        }
        // Press-and-drag release on a DIFFERENT tile = drop.
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
function HelpCornerOverlay({ onActivate }: { onActivate: () => void }) {
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
