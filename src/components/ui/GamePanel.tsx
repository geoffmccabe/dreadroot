// Reusable floating game panel — the shared shell for ALL movable HUD panels so we
// don't re-invent one each time. Matches the User Panel look/feel: hud transparency
// + blur, drag-to-move (header), resize (corner handle), and the glow that fires on
// open / move / resize. Floating (non-modal) so the 3D world stays visible behind it.
import { ReactNode, useEffect, useState, type CSSProperties } from 'react';
import { useGlowPanel } from '@/hooks/useGlowPanel';
import { usePanelDrag } from '@/hooks/usePanelDrag';

interface GamePanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Base position before the user drags it (e.g. { top: 80, left: 16 }). */
  initialStyle?: CSSProperties;
}

export function GamePanel({
  open, onClose, title, children,
  defaultWidth = 380, defaultHeight = 560,
  minWidth = 300, maxWidth = 900, minHeight = 280, maxHeight = 900,
  initialStyle,
}: GamePanelProps) {
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
  const [isResizing, setIsResizing] = useState(false);
  const glow = useGlowPanel();
  const drag = usePanelDrag(glow.trigger);

  useEffect(() => { if (open) glow.trigger(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    glow.trigger();
    const sx = e.clientX, sy = e.clientY, sw = size.width, sh = size.height;
    let raf = false, cw = sw, ch = sh;
    const mm = (m: MouseEvent) => {
      cw = Math.max(minWidth, Math.min(maxWidth, sw + (m.clientX - sx)));
      ch = Math.max(minHeight, Math.min(maxHeight, sh + (m.clientY - sy)));
      if (raf) return;
      raf = true;
      requestAnimationFrame(() => { raf = false; setSize({ width: cw, height: ch }); });
    };
    const mu = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', mm);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  };

  if (!open) return null;

  return (
    <div
      ref={(node) => {
        drag.panelRef.current = node;
        if (node) {
          node.style.setProperty('background', 'hsla(var(--hud-bg))', 'important');
          node.style.setProperty('border', '1px solid hsla(var(--hud-border))', 'important');
        }
      }}
      className="hud-panel hud-draggable fixed flex flex-col overflow-hidden"
      style={{
        width: size.width,
        height: size.height,
        zIndex: 50,
        ...(initialStyle ?? { top: 80, left: 16 }),
        borderRadius: 'var(--hud-radius)',
        transition: isResizing ? 'none' : glow.glowTransition,
        boxShadow: glow.boxShadow,
        backdropFilter: isResizing ? 'none' : 'var(--hud-blur)',
        WebkitBackdropFilter: isResizing ? 'none' : 'var(--hud-blur)',
        color: 'hsl(var(--hud-text))',
        fontFamily: 'var(--hud-font)',
        ...drag.dragStyle,
      }}
    >
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 pt-3 pb-2 select-none"
        style={{ cursor: 'move', color: 'hsl(var(--hud-text-bright))' }}
        onMouseDown={drag.onHeaderMouseDown}
      >
        <div className="font-semibold text-sm">{title}</div>
        <button data-no-drag onClick={onClose} className="px-2 opacity-70 hover:opacity-100">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">{children}</div>
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeStart}
        style={{
          zIndex: 3,
          background: 'linear-gradient(135deg, transparent 50%, currentColor 50%)',
          opacity: isResizing ? 0.8 : 0.3,
          transition: 'opacity 0.2s',
        }}
      />
    </div>
  );
}
