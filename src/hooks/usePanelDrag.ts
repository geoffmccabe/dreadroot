// usePanelDrag — drag a (normally-centered) modal panel by its header. Reusable so
// every panel moves the same way. rAF-throttled for smoothness; ignores drags that
// start on header controls (buttons/inputs/tabs). Pass a callback (the glow trigger)
// fired on grab.
//
//   const drag = usePanelDrag(glow.trigger);
//   <DialogContent ref={node => { drag.panelRef.current = node; … }}
//                  style={{ …, ...drag.dragStyle }}>
//     <DialogHeader onMouseDown={drag.onHeaderMouseDown} style={{ cursor: 'move' }}>

import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export function usePanelDrag(onGrab?: () => void) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // don't start a drag from an interactive control in the header
    if ((e.target as HTMLElement).closest('button, input, a, select, [role="tab"], [data-no-drag]')) return;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onGrab?.();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    let raf = false;
    let nx = rect.left;
    let ny = rect.top;
    const onMove = (m: MouseEvent) => {
      nx = Math.max(0, Math.min(window.innerWidth - 80, m.clientX - offX));
      ny = Math.max(0, Math.min(window.innerHeight - 40, m.clientY - offY));
      if (raf) return;
      raf = true;
      requestAnimationFrame(() => { raf = false; setPos({ x: nx, y: ny }); });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onGrab]);

  // When moved, override the modal's centering with an explicit position.
  const dragStyle: CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, transform: 'none', margin: 0 }
    : {};

  return { panelRef, onHeaderMouseDown, dragStyle, moved: pos !== null };
}
