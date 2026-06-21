// useDraggablePanel — makes a fixed-position panel draggable by a handle element.
// Returns the live {left, top} (apply to the panel) and handleProps (spread onto the drag
// handle, e.g. the title bar). Uses pointer capture so the drag keeps tracking outside the
// element. Position is in screen pixels from the top-left.
import { useCallback, useRef, useState } from 'react';

export function useDraggablePanel(initial: { left: number; top: number }) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // offset from the panel's current top-left to the cursor, so it doesn't jump on grab
    drag.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, [pos.left, pos.top]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos({ left: e.clientX - drag.current.dx, top: e.clientY - drag.current.dy });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  return {
    pos,
    handleProps: { onPointerDown, onPointerMove, onPointerUp, style: { cursor: 'move' as const, touchAction: 'none' as const } },
  };
}
