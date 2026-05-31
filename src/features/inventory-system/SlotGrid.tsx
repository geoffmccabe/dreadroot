// Generic positional slot grid. Renders any region (vault page, inv,
// QS) using the same DOM + interaction layer. NO HTML5 drag/drop —
// every interaction is pointerdown / contextmenu, dispatched through
// the slotClick reducer.
//
// Each slot receives:
//   - left-click → slotClick(button: 'left')
//   - right-click → slotClick(button: 'right') + preventDefault
//   - shift held → slotClick(shift: true)
//   - double-click → slotClick(doubleClick: true)
//
// The parent provides the occupant data (already resolved item def);
// SlotGrid is purely presentational + event-routing.

import React from 'react';
import type { SlotLocation, SlotOccupant, SlotClickInput } from './types';
import { useCursorStack } from './useCursorStack';
import { ItemTileVisual } from './ItemTileVisual';

const TILE = 56;
const GAP = 6;

export interface SlotGridProps {
  rows: number;
  cols: number;
  /** map slotIndex (0..rows*cols-1) → occupant (or null if empty) */
  occupants: Map<number, SlotOccupant>;
  /** Build the SlotLocation for a given slotIndex. */
  locationOf: (slotIndex: number) => SlotLocation;
  /** Called for every click on every slot. */
  onSlotClick: (input: SlotClickInput) => void;
  /** Optional: called on right-click when the cursor stack is empty.
   *  If provided, takes precedence over slotClick's right-click ("take
   *  half") so right-click can open an info / detail modal instead.
   *  Hold Shift while right-clicking to bypass and fall through to
   *  slotClick (take-half). */
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
  const cursor = useCursorStack((s) => s.cursor);

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
            onClick={(button, shift, doubleClick) => {
              // Right-click + empty cursor + onSlotInspect provided +
              // not holding shift → open detail modal instead of
              // take-half. Restores prior UX where right-click was
              // always "info." Shift+right-click goes through slotClick
              // so the Minecraft take-half gesture is still reachable.
              if (button === 'right' && !shift && !cursor && occ && onSlotInspect) {
                onSlotInspect(occ);
                return;
              }
              onSlotClick({
                location: locationOf(i),
                occupant: occ ?? null,
                button,
                shift,
                doubleClick,
              });
            }}
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
}

function SlotTile({ slotIndex, occupant, ghosted, highlight, onClick }: SlotTileProps) {
  const cursor = useCursorStack((s) => s.cursor);
  const cursorActive = cursor !== null;
  const [isHovered, setIsHovered] = React.useState(false);

  // Drop-target highlight: only show a hover highlight when a cursor
  // stack is being held AND this slot would accept the drop. Empty
  // slot = always accepts. Slot with the same stackable item = accepts
  // (would merge). Slot with a different item = no highlight (swap
  // isn't supported yet). The ghosted source slot also doesn't
  // highlight — releasing there is a no-op.
  const wouldAcceptDrop =
    cursorActive && isHovered && !ghosted &&
    (!occupant || (occupant.itemId === cursor!.itemId && !occupant.nonStackable));

  return (
    <div
      onPointerDown={(e) => {
        if (e.button === 0) onClick('left', e.shiftKey, false);
        else if (e.button === 2) onClick('right', e.shiftKey, false);
      }}
      onPointerUp={(e) => {
        // Press-and-drag support. Releasing the pointer on a
        // DIFFERENT tile than the pickup completes the drop in a
        // single gesture. Releasing on the source tile (ghosted) is
        // a no-op; the cursor stays held for a follow-up click.
        if (e.button !== 0) return;
        if (!cursor) return;
        if (ghosted) return;
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
          ? '2px solid hsla(120, 100%, 60%, 0.95)'   // green = will drop here
          : highlight
            ? '1px solid hsla(45, 100%, 60%, 0.9)'
            : '1px solid hsla(var(--hud-border, 0 0% 100% / 0.3))',
        background: wouldAcceptDrop
          ? 'hsla(120, 60%, 25%, 0.35)'              // subtle green tint
          : 'hsla(var(--hud-bg-dim, 0 0% 0% / 0.4))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
        cursor: cursorActive ? 'pointer' : (occupant ? 'pointer' : 'default'),
        // 80% transparency on the ghosted source tile so the user can
        // see it's been picked up while the original silhouette stays
        // visible.
        opacity: ghosted ? 0.2 : 1,
        userSelect: 'none',
      }}
    >
      <ItemTileVisual occupant={occupant ?? null} />
    </div>
  );
}
