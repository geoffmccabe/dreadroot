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
  // Sprite is sized to match an inventory tile (56×56 container with
  // a 42×42 image inside), so the picked-up item looks like the same
  // tile that lifted out of its slot — not a smaller floating chip.
  const SPRITE_SIZE = 56;
  const HALF = SPRITE_SIZE / 2;

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = ref.current;
      if (el) {
        // Center the sprite ON the pointer — the mouse-tip position
        // determines what slot is targeted, the sprite just floats
        // centered around it.
        el.style.transform = `translate3d(${e.clientX - HALF}px, ${e.clientY - HALF}px, 0)`;
      }
    };
    window.addEventListener('pointermove', handler);
    return () => window.removeEventListener('pointermove', handler);
  }, []);

  // On mount of a NEW cursor stack, position immediately at the last
  // known pointer (otherwise the sprite renders at 0,0 until the next
  // mousemove).
  useEffect(() => {
    if (!cursor) return;
    const el = ref.current;
    if (!el) return;
    const lastX = (window as any).__lastPointerX as number | undefined;
    const lastY = (window as any).__lastPointerY as number | undefined;
    if (lastX != null && lastY != null) {
      el.style.transform = `translate3d(${lastX - HALF}px, ${lastY - HALF}px, 0)`;
    }
  }, [cursor]);

  // Track latest pointer position on the window so the cursor sprite
  // can position itself the moment it appears.
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
        width: SPRITE_SIZE,
        height: SPRITE_SIZE,
        pointerEvents: 'none',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Same tile background as a real slot — picked-up tile should
        // look identical to where it came from, not get a "drag mode"
        // dark chrome.
        background: 'hsla(var(--hud-bg-dim, 0 0% 0% / 0.4))',
        border: '1px solid hsla(var(--hud-border, 0 0% 100% / 0.3))',
        borderRadius: 'var(--hud-radius, 4px)',
      }}
    >
      {cursor.tier != null && (
        <span style={{
          position: 'absolute', top: 2, left: 4,
          fontSize: 10, fontWeight: 700, color: 'white',
          textShadow: '0 0 3px rgba(0,0,0,0.8)',
        }}>T{cursor.tier}</span>
      )}
      {cursor.spriteUrl && (
        <img
          src={cursor.spriteUrl}
          alt={cursor.name}
          draggable={false}
          style={{ width: 42, height: 42, objectFit: 'contain' }}
        />
      )}
      {cursor.quantity > 1 && (
        <span style={{
          position: 'absolute', bottom: 2, right: 4,
          fontSize: 11, fontWeight: 700, color: 'white',
          textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.9)',
        }}>{cursor.quantity}</span>
      )}
    </div>
  );
}
