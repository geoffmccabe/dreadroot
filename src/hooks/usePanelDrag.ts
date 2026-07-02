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
      requestAnimationFrame(() => {
        raf = false;
        // Write the position as !important inline styles directly on the node. The
        // panels pin their corner via CSS !important (.{user,admin}-panel-dialog
        // [data-state="open"] set position/top/right !important), which a normal
        // inline style can't beat — so a plain style prop wouldn't move them.
        // Inline !important wins. (Keep left/top OUT of the React style object, or
        // React would re-set them without the important flag and clobber this.)
        const node = panelRef.current;
        if (node) {
          node.style.setProperty('position', 'fixed', 'important');
          node.style.setProperty('left', `${nx}px`, 'important');
          node.style.setProperty('top', `${ny}px`, 'important');
          node.style.setProperty('right', 'auto', 'important');
          node.style.setProperty('bottom', 'auto', 'important');
          node.style.setProperty('transform', 'none', 'important');
          node.style.setProperty('translate', 'none', 'important');
          node.style.setProperty('margin', '0', 'important');
        }
        setPos({ x: nx, y: ny });
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onGrab]);

  // Position is applied as !important inline styles during the drag (see onMove);
  // dragStyle stays empty so React never re-sets left/top without the important
  // flag. Kept in the return for call-site compatibility.
  const dragStyle: CSSProperties = {};

  return { panelRef, onHeaderMouseDown, dragStyle, moved: pos !== null };
}
