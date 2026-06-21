// PanelGrabBar — a small visible drag handle centered at the top of a movable
// HUD panel. It's a real element (not a CSS pseudo) wired to the panel's
// drag handler, so clicking/dragging it actually moves the panel and fires the
// edge-glow (usePanelDrag's onGrab). Centered + narrow so it never covers the
// close button (top-right). Shared by every draggable panel for one look/feel.
import React from 'react';

export function PanelGrabBar({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to move"
      style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 120,
        height: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'move',
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: 46,
          height: 4,
          borderRadius: 2,
          background: 'hsla(var(--hud-border-h) / 0.75)',
        }}
      />
    </div>
  );
}
