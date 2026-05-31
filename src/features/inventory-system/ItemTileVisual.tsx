// THE single component for "how an item looks inside a slot." Used by
// every region: vault tile, inventory tile, hotbar tile, AND the
// floating cursor sprite. There must never be more than one item-tile
// renderer in this codebase — if you find yourself styling a tier
// badge or quantity badge anywhere else, route it through here.
//
// Renders only the CONTENT of a tile (tier badge top-left, sprite
// centered, quantity "Nx" bottom-right). Outer chrome — slot size,
// border, background, hover/selection styling — is the caller's
// responsibility. That separation lets the cursor sprite reuse this
// component too, without dragging in slot-grid-specific styling.

import React from 'react';

export interface ItemTileVisualOccupant {
  spriteUrl: string | null;
  name: string;
  tier: number | null;
  quantity: number;
}

export interface ItemTileVisualProps {
  occupant: ItemTileVisualOccupant | null;
  /** Image side length in px. Default 42 — matches the canonical
   *  slot tile (56px tile with a 42px sprite inside). */
  spriteSize?: number;
}

export function ItemTileVisual({ occupant, spriteSize = 42 }: ItemTileVisualProps) {
  if (!occupant) return null;
  return (
    <>
      {occupant.tier != null && (
        <span style={{
          position: 'absolute',
          top: 2,
          left: 4,
          fontSize: 10,
          fontWeight: 700,
          color: 'white',
          fontFamily: 'var(--hud-font)',
          lineHeight: 1,
          textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.9)',
          pointerEvents: 'none',
          zIndex: 2,
        }}>
          T{occupant.tier}
        </span>
      )}
      {occupant.spriteUrl && (
        <img
          src={occupant.spriteUrl}
          alt={occupant.name}
          draggable={false}
          style={{
            width: spriteSize,
            height: spriteSize,
            objectFit: 'contain',
            pointerEvents: 'none',
          }}
        />
      )}
      {occupant.quantity > 1 && (
        <span style={{
          position: 'absolute',
          bottom: 2,
          right: 4,
          fontSize: 11,
          fontWeight: 700,
          color: 'white',
          fontFamily: 'var(--hud-font)',
          lineHeight: 1,
          textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.9)',
          pointerEvents: 'none',
        }}>
          {occupant.quantity}x
        </span>
      )}
    </>
  );
}
