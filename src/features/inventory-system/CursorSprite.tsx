// One floating sprite that follows the mouse cursor whenever the user
// is holding an item stack. Mounted ONCE inside FortressHUD. There is
// no per-region cursor; this is the entire "drag image" for the
// inventory UI.
//
// pointer-events: none so it never intercepts clicks. Updates its own
// transform on every pointermove via direct DOM mutation (no React
// re-render per move) for smoothness on low-end devices.

import React, { useEffect, useRef } from 'react';
import { useCursorStack } from './useCursorStack';

export function CursorSprite() {
  const cursor = useCursorStack((s) => s.cursor);
  const ref = useRef<HTMLDivElement | null>(null);

  // Global pointermove → directly mutate transform. No React re-render
  // per move; React only re-renders when the cursor stack itself
  // appears, changes, or disappears.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = ref.current;
      if (el) {
        // +14/+8 offset so the sprite sits below-right of the actual
        // pointer tip, matching the Minecraft cursor stack rendering.
        el.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 8}px, 0)`;
      }
    };
    window.addEventListener('pointermove', handler);
    return () => window.removeEventListener('pointermove', handler);
  }, []);

  if (!cursor) return null;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 48,
        height: 48,
        pointerEvents: 'none',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'hsla(0, 0%, 0%, 0.35)',
        border: '1px solid hsla(0, 0%, 100%, 0.4)',
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      }}
    >
      {cursor.tier != null && (
        <span style={{
          position: 'absolute', top: 1, left: 3,
          fontSize: 9, fontWeight: 700, color: 'white',
          textShadow: '0 0 3px rgba(0,0,0,0.95)',
        }}>T{cursor.tier}</span>
      )}
      {cursor.spriteUrl && (
        <img
          src={cursor.spriteUrl}
          alt={cursor.name}
          draggable={false}
          style={{ width: 36, height: 36, objectFit: 'contain' }}
        />
      )}
      {cursor.quantity > 1 && (
        <span style={{
          position: 'absolute', bottom: 1, right: 3,
          fontSize: 11, fontWeight: 700, color: 'white',
          textShadow: '0 0 3px rgba(0,0,0,0.95)',
        }}>{cursor.quantity}</span>
      )}
    </div>
  );
}
