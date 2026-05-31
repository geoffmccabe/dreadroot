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
  /** Optional: highlight a particular slot (e.g. equipped indicator). */
  highlightSlot?: number;
  /** Optional: dim a slot (e.g. ghosted while on cursor). */
  isSlotGhosted?: (slotIndex: number) => boolean;
}

export function SlotGrid({
  rows, cols, occupants, locationOf, onSlotClick, highlightSlot, isSlotGhosted,
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
}

function SlotTile({ slotIndex, occupant, ghosted, highlight, onClick }: SlotTileProps) {
  const cursorActive = useCursorStack((s) => s.cursor !== null);

  return (
    <div
      onPointerDown={(e) => {
        if (e.button === 0) onClick('left', e.shiftKey, false);
        else if (e.button === 2) onClick('right', e.shiftKey, false);
      }}
      onContextMenu={(e) => {
        // Always suppress the browser context menu on inventory slots.
        e.preventDefault();
      }}
      onDoubleClick={(e) => {
        // Don't double-fire — onPointerDown fired first for the left
        // click; only the second click in the dblclick produces the
        // dblclick event. Use it for collect-all style actions.
        onClick('left', e.shiftKey, true);
      }}
      style={{
        width: TILE,
        height: TILE,
        borderRadius: 'var(--hud-radius, 4px)',
        border: highlight
          ? '1px solid hsla(45, 100%, 60%, 0.9)'
          : '1px solid hsla(var(--hud-border, 0 0% 100% / 0.3))',
        background: 'hsla(var(--hud-bg-dim, 0 0% 0% / 0.4))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
        cursor: cursorActive ? 'pointer' : (occupant ? 'pointer' : 'default'),
        opacity: ghosted ? 0.35 : 1,
        userSelect: 'none',
      }}
    >
      {occupant?.tier != null && (
        <span style={{
          position: 'absolute', top: 2, left: 4,
          fontSize: 10, fontWeight: 700, color: 'white',
          textShadow: '0 0 3px rgba(0,0,0,0.8)', pointerEvents: 'none',
        }}>T{occupant.tier}</span>
      )}
      {occupant?.spriteUrl && (
        <img
          src={occupant.spriteUrl}
          alt={occupant.name}
          draggable={false}
          style={{ width: 42, height: 42, objectFit: 'contain', pointerEvents: 'none' }}
        />
      )}
      {occupant && occupant.quantity > 1 && (
        <span style={{
          position: 'absolute', bottom: 2, right: 4,
          fontSize: 11, fontWeight: 700, color: 'white',
          textShadow: '0 0 3px rgba(0,0,0,0.9)', pointerEvents: 'none',
        }}>{occupant.quantity}</span>
      )}
    </div>
  );
}
