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
        // Center the 48×48 sprite ON the pointer so it lifts from the
        // exact click point — no jump to an offset. The mouse position
        // still indicates the drop target; the sprite is just attached
        // to (and centered on) the cursor.
        el.style.transform = `translate3d(${e.clientX - 24}px, ${e.clientY - 24}px, 0)`;
      }
    };
    window.addEventListener('pointermove', handler);
    return () => window.removeEventListener('pointermove', handler);
  }, []);

  // On mount of a NEW cursor stack, also set position immediately
  // (otherwise the sprite renders at 0,0 until the next mousemove).
  useEffect(() => {
    if (!cursor) return;
    const el = ref.current;
    if (!el) return;
    // Best-effort: use the last known pointer position. If we don't
    // have one, fall back to viewport center so the sprite at least
    // appears somewhere visible.
    const lastX = (window as any).__lastPointerX as number | undefined;
    const lastY = (window as any).__lastPointerY as number | undefined;
    if (lastX != null && lastY != null) {
      el.style.transform = `translate3d(${lastX - 24}px, ${lastY - 24}px, 0)`;
    }
  }, [cursor]);

  // Track the latest pointer position on the window so the cursor
  // sprite can position itself the moment it appears.
  useEffect(() => {
    const tracker = (e: PointerEvent) => {
      (window as any).__lastPointerX = e.clientX;
      (window as any).__lastPointerY = e.clientY;
    };
    window.addEventListener('pointermove', tracker);
    window.addEventListener('pointerdown', tracker);
    return () => {
      window.removeEventListener('pointermove', tracker);
      window.removeEventListener('pointerdown', tracker);
    };
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
