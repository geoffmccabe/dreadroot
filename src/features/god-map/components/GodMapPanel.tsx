// God Map admin panel. Opened with Cmd+M. 90%×95% of viewport, canvas-
// based, two zoom levels (chunk and voxel), drag-to-pan, hover-to-
// inspect, paint/erase no-plant chunks (superadmin only).
//
// Render order per frame:
//   1. Water border (light blue) outside the map bounds
//   2. Per-chunk fill — empty=dark, has-blocks=mid-grey shaded by density
//   3. Painted no-plant chunks — red overlay
//   4. Tree pixels — all trees if admin, owner's trees only otherwise.
//      Owner's trees pulse.
//   5. Player position — bright green flashing dot
//
// Hover detection lives in the canvas mousemove handler; tooltip is
// positioned in screen space via getBoundingClientRect().

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useGodMap, type MapTree } from '../hooks/useGodMap';

interface Props {
  open: boolean;
  onClose: () => void;
  worldId: string | null;
  currentUserId: string | null;
  userRoles: string[];
  /** Mutable ref to the player's current world position, kept up to
   *  date by the scene's per-frame loop. The panel reads it each
   *  render frame to draw the flashing green "you are here" dot. */
  playerPositionRef: React.RefObject<THREE.Vector3 | null>;
}

type Tool = 'pan' | 'paint' | 'erase';

const WATER_PAD_CHUNKS = 10;
const CHUNK_SIZE = 16;
const PULSE_HZ = 2; // pulses per second for owned trees + player marker

export function GodMapPanel({
  open,
  onClose,
  worldId,
  currentUserId,
  userRoles,
  playerPositionRef,
}: Props) {
  const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');
  const isSuperadmin = userRoles.includes('superadmin');

  const { trees, noPlant, density, bounds, loading, paintChunks, eraseChunks } =
    useGodMap({ worldId, enabled: open });

  // Tool / zoom state
  const [tool, setTool] = useState<Tool>('pan');
  const [brushWidth, setBrushWidth] = useState<1 | 2 | 3>(1);
  const [zoomLevel, setZoomLevel] = useState<'chunk' | 'voxel'>('chunk');
  // Pan offset in MAP CELLS (chunks at chunk zoom, voxels at voxel zoom).
  const [panX, setPanX] = useState(0);
  const [panZ, setPanZ] = useState(0);

  // Hover state for the tooltip.
  const [hover, setHover] = useState<{
    screenX: number;
    screenY: number;
    tree: MapTree | null;
  } | null>(null);

  // Mouse drag state — paint/erase drag-paints continuously, pan tool
  // grabs and drags the view.
  const dragRef = useRef<{
    active: boolean;
    mode: Tool;
    lastMouse: { x: number; y: number } | null;
    paintedThisDrag: Set<string>;
  }>({ active: false, mode: 'pan', lastMouse: null, paintedThisDrag: new Set() });

  // Canvas + container refs. Container size is STATE (not just a ref)
  // so the layout useMemo recomputes when the panel mounts and the
  // ResizeObserver fires — without that, the canvas stayed 0×0 and
  // nothing rendered.
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const sizeRef = useRef(containerSize);
  useEffect(() => { sizeRef.current = containerSize; }, [containerSize]);

  // Build extended bounds (data bounds + 10-chunk water border).
  const ext = useMemo(() => {
    if (!bounds) return null;
    return {
      minChunkX: bounds.minChunkX - WATER_PAD_CHUNKS,
      maxChunkX: bounds.maxChunkX + WATER_PAD_CHUNKS,
      minChunkZ: bounds.minChunkZ - WATER_PAD_CHUNKS,
      maxChunkZ: bounds.maxChunkZ + WATER_PAD_CHUNKS,
    };
  }, [bounds]);

  // Cell→pixel scale: pick the largest integer that still fits the panel.
  const layout = useMemo(() => {
    if (!ext) return null;
    const widthChunks = ext.maxChunkX - ext.minChunkX + 1;
    const heightChunks = ext.maxChunkZ - ext.minChunkZ + 1;
    const widthCells = zoomLevel === 'chunk' ? widthChunks : widthChunks * CHUNK_SIZE;
    const heightCells = zoomLevel === 'chunk' ? heightChunks : heightChunks * CHUNK_SIZE;
    // Canvas is sized to the container; pick a scale that lets the
    // whole content fit at chunk zoom and pan-around at voxel zoom.
    const { w, h } = containerSize;
    if (!w || !h) return { widthCells, heightCells, scale: 1, fits: true };
    const fitScale = Math.max(1, Math.min(Math.floor(w / widthCells), Math.floor(h / heightCells)));
    const fits = (widthCells * fitScale <= w) && (heightCells * fitScale <= h);
    // Voxel zoom uses scale = 1 (one screen pixel per voxel) so the
    // map is intentionally larger than the panel and pannable.
    return {
      widthCells,
      heightCells,
      scale: zoomLevel === 'chunk' ? fitScale : 1,
      fits,
    };
  }, [ext, zoomLevel, containerSize]);

  // Render. Re-runs on every state change to data, zoom, pan, or hover.
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv || !ext || !layout) return;
    const ctx = cnv.getContext('2d');
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    if (cnv.width !== w || cnv.height !== h) {
      cnv.width = w;
      cnv.height = h;
    }
    ctx.imageSmoothingEnabled = false;

    // 1. Wipe with the WATER color so the padding area is implicit.
    ctx.fillStyle = '#9bcfe8'; // light blue water
    ctx.fillRect(0, 0, w, h);

    const isVoxel = zoomLevel === 'voxel';
    const scale = layout.scale;

    // Convert a CHUNK coord to screen pixel coords.
    const chunkToScreen = (cx: number, cz: number): { x: number; y: number; size: number } => {
      // Cell index within the extended bounds.
      const cellX = isVoxel ? (cx - ext.minChunkX) * CHUNK_SIZE : (cx - ext.minChunkX);
      const cellZ = isVoxel ? (cz - ext.minChunkZ) * CHUNK_SIZE : (cz - ext.minChunkZ);
      // Pan offset is in cells.
      const screenX = (cellX + panX) * scale;
      const screenY = (cellZ + panZ) * scale;
      const size = isVoxel ? CHUNK_SIZE * scale : scale;
      return { x: screenX, y: screenY, size };
    };

    // 2. Per-chunk fill. All in-map chunks get the ground green; chunks
    // with blocks get a slightly darker tone so dense areas read at a
    // glance. (Per 2026-May-28 brand: ground is hsl(69 33% 64%); a
    // ~12% lightness drop reads as "denser" without losing the green.)
    const GROUND_GREEN = 'hsl(69, 33%, 64%)';
    for (let cx = bounds!.minChunkX; cx <= bounds!.maxChunkX; cx++) {
      for (let cz = bounds!.minChunkZ; cz <= bounds!.maxChunkZ; cz++) {
        const { x, y, size } = chunkToScreen(cx, cz);
        if (x + size < 0 || y + size < 0 || x > w || y > h) continue;
        const dens = density.get(`${cx},${cz}`) ?? 0;
        if (dens === 0) {
          ctx.fillStyle = GROUND_GREEN;
        } else {
          const t = Math.min(1, Math.log10(dens + 1) / 4); // 0..1
          const lightness = 64 - Math.floor(t * 18);       // 64..46
          ctx.fillStyle = `hsl(69, 33%, ${lightness}%)`;
        }
        ctx.fillRect(x, y, size, size);
      }
    }

    // 2b. Voxel zoom: draw 1-voxel-wide chunk boundary lines so the
    // grid is legible. Color is the lighter brand green so the lines
    // sit above the ground without screaming.
    if (isVoxel) {
      ctx.fillStyle = 'hsl(69, 24%, 75%)';
      for (let cx = bounds!.minChunkX; cx <= bounds!.maxChunkX + 1; cx++) {
        const cellX = (cx - ext.minChunkX) * CHUNK_SIZE;
        const sx = (cellX + panX) * scale;
        if (sx < -scale || sx > w) continue;
        // Vertical line at this chunk-boundary x.
        const topCell = (bounds!.minChunkZ - ext.minChunkZ) * CHUNK_SIZE;
        const botCell = (bounds!.maxChunkZ + 1 - ext.minChunkZ) * CHUNK_SIZE;
        const y0 = (topCell + panZ) * scale;
        const y1 = (botCell + panZ) * scale;
        ctx.fillRect(sx, y0, scale, y1 - y0);
      }
      for (let cz = bounds!.minChunkZ; cz <= bounds!.maxChunkZ + 1; cz++) {
        const cellZ = (cz - ext.minChunkZ) * CHUNK_SIZE;
        const sy = (cellZ + panZ) * scale;
        if (sy < -scale || sy > h) continue;
        const leftCell = (bounds!.minChunkX - ext.minChunkX) * CHUNK_SIZE;
        const rightCell = (bounds!.maxChunkX + 1 - ext.minChunkX) * CHUNK_SIZE;
        const x0 = (leftCell + panX) * scale;
        const x1 = (rightCell + panX) * scale;
        ctx.fillRect(x0, sy, x1 - x0, scale);
      }
    }

    // 3. No-plant overlay.
    ctx.fillStyle = 'rgba(220, 60, 60, 0.55)';
    for (const key of noPlant) {
      const [cxStr, czStr] = key.split(',');
      const cx = parseInt(cxStr, 10);
      const cz = parseInt(czStr, 10);
      const { x, y, size } = chunkToScreen(cx, cz);
      if (x + size < 0 || y + size < 0 || x > w || y > h) continue;
      ctx.fillRect(x, y, size, size);
    }

    // 4. Trees. Non-admins only see their own; admins see everything but
    //    their own pulse.
    const now = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(now * PULSE_HZ * Math.PI * 2);
    for (const t of trees) {
      const isOwn = t.ownerUserId === currentUserId;
      if (!isAdmin && !isOwn) continue;
      const cx = Math.floor(t.baseX / CHUNK_SIZE);
      const cz = Math.floor(t.baseZ / CHUNK_SIZE);
      const screen = chunkToScreen(cx, cz);
      // At voxel zoom, refine to the exact base position within the chunk.
      let px = screen.x, py = screen.y;
      if (isVoxel) {
        const lx = t.baseX - cx * CHUNK_SIZE;
        const lz = t.baseZ - cz * CHUNK_SIZE;
        px = ((cx - ext.minChunkX) * CHUNK_SIZE + lx + panX) * scale;
        py = ((cz - ext.minChunkZ) * CHUNK_SIZE + lz + panZ) * scale;
      }
      const dotSize = Math.max(2, scale);
      // Color per tree type.
      const baseColor =
        t.treeType === 'fungal' ? '#c060e0'
        : t.treeType === 'wide' ? '#e09040'
        : '#60d060';
      if (isOwn) {
        ctx.fillStyle = baseColor;
        ctx.globalAlpha = 0.4 + 0.6 * pulse;
      } else {
        ctx.fillStyle = baseColor;
        ctx.globalAlpha = 0.7;
      }
      ctx.fillRect(px, py, dotSize, dotSize);
      ctx.globalAlpha = 1;
    }

    // 5. Player position — bright green flashing dot.
    const pos = playerPositionRef.current;
    if (pos) {
      const pcx = Math.floor(pos.x / CHUNK_SIZE);
      const pcz = Math.floor(pos.z / CHUNK_SIZE);
      const screen = chunkToScreen(pcx, pcz);
      let px = screen.x, py = screen.y;
      if (isVoxel) {
        const lx = Math.floor(pos.x) - pcx * CHUNK_SIZE;
        const lz = Math.floor(pos.z) - pcz * CHUNK_SIZE;
        px = ((pcx - ext.minChunkX) * CHUNK_SIZE + lx + panX) * scale;
        py = ((pcz - ext.minChunkZ) * CHUNK_SIZE + lz + panZ) * scale;
      }
      const dotSize = Math.max(3, scale * 2);
      ctx.fillStyle = '#00ff44';
      ctx.globalAlpha = 0.5 + 0.5 * pulse;
      ctx.fillRect(px - dotSize / 2, py - dotSize / 2, dotSize, dotSize);
      ctx.globalAlpha = 1;
    }
  }, [ext, layout, density, noPlant, trees, panX, panZ, zoomLevel, bounds, currentUserId, isAdmin, playerPositionRef]);

  // Animation loop for pulse — re-runs the render effect on every frame
  // while the panel is open by tracking a tick state.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const loop = () => {
      setTick(t => (t + 1) % 1000000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Resize observer for the canvas container.
  useEffect(() => {
    if (!open) return;
    const c = containerRef.current;
    if (!c) return;
    const update = () => {
      const r = c.getBoundingClientRect();
      setContainerSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    return () => ro.disconnect();
  }, [open]);

  // Mouse → cell coordinates helper.
  const mouseToCell = useCallback((clientX: number, clientY: number): { cx: number; cz: number; vx: number; vz: number } | null => {
    const cnv = canvasRef.current;
    if (!cnv || !ext || !layout) return null;
    const r = cnv.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const isVoxel = zoomLevel === 'voxel';
    const scale = layout.scale;
    const cellX = Math.floor(x / scale) - panX;
    const cellZ = Math.floor(y / scale) - panZ;
    if (isVoxel) {
      const vx = ext.minChunkX * CHUNK_SIZE + cellX;
      const vz = ext.minChunkZ * CHUNK_SIZE + cellZ;
      return { cx: Math.floor(vx / CHUNK_SIZE), cz: Math.floor(vz / CHUNK_SIZE), vx, vz };
    }
    const cx = ext.minChunkX + cellX;
    const cz = ext.minChunkZ + cellZ;
    return { cx, cz, vx: cx * CHUNK_SIZE, vz: cz * CHUNK_SIZE };
  }, [ext, layout, panX, panZ, zoomLevel]);

  // Tree lookup for tooltip — within 1 cell of cursor.
  const findTreeNearMouse = useCallback((clientX: number, clientY: number): MapTree | null => {
    const m = mouseToCell(clientX, clientY);
    if (!m) return null;
    const visibleTrees = trees.filter(t => isAdmin || t.ownerUserId === currentUserId);
    let best: MapTree | null = null;
    let bestDist = Infinity;
    for (const t of visibleTrees) {
      const tcx = Math.floor(t.baseX / CHUNK_SIZE);
      const tcz = Math.floor(t.baseZ / CHUNK_SIZE);
      if (zoomLevel === 'chunk') {
        const dx = Math.abs(tcx - m.cx);
        const dz = Math.abs(tcz - m.cz);
        if (dx <= 1 && dz <= 1) {
          const d = dx + dz;
          if (d < bestDist) { bestDist = d; best = t; }
        }
      } else {
        const dx = Math.abs(t.baseX - m.vx);
        const dz = Math.abs(t.baseZ - m.vz);
        if (dx <= 1 && dz <= 1) {
          const d = dx + dz;
          if (d < bestDist) { bestDist = d; best = t; }
        }
      }
    }
    return best;
  }, [mouseToCell, trees, isAdmin, currentUserId, zoomLevel]);

  // Brush stamp: returns the chunks that a brush of width N centered on
  // the given (cx,cz) covers.
  const brushChunks = useCallback((cx: number, cz: number): Array<{ cx: number; cz: number }> => {
    const half = Math.floor(brushWidth / 2);
    const out: Array<{ cx: number; cz: number }> = [];
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        out.push({ cx: cx + dx, cz: cz + dz });
      }
    }
    return out;
  }, [brushWidth]);

  // Mouse handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const m = mouseToCell(e.clientX, e.clientY);
    if (!m) return;
    dragRef.current = {
      active: true,
      mode: tool,
      lastMouse: { x: e.clientX, y: e.clientY },
      paintedThisDrag: new Set(),
    };
    if (tool === 'paint' && isSuperadmin) {
      const stamp = brushChunks(m.cx, m.cz);
      for (const c of stamp) dragRef.current.paintedThisDrag.add(`${c.cx},${c.cz}`);
      void paintChunks(stamp);
    } else if (tool === 'erase' && isSuperadmin) {
      const stamp = brushChunks(m.cx, m.cz);
      for (const c of stamp) dragRef.current.paintedThisDrag.add(`${c.cx},${c.cz}`);
      void eraseChunks(stamp);
    }
  }, [mouseToCell, tool, isSuperadmin, brushChunks, paintChunks, eraseChunks]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (drag.active && drag.lastMouse) {
      if (drag.mode === 'pan') {
        // Drag-pan: translate pan by mouse delta divided by scale.
        const scale = layout?.scale ?? 1;
        const dx = e.clientX - drag.lastMouse.x;
        const dy = e.clientY - drag.lastMouse.y;
        const cellDx = Math.round(dx / scale);
        const cellDy = Math.round(dy / scale);
        if (cellDx !== 0 || cellDy !== 0) {
          setPanX(p => p + cellDx);
          setPanZ(p => p + cellDy);
          drag.lastMouse = { x: e.clientX, y: e.clientY };
        }
      } else if ((drag.mode === 'paint' || drag.mode === 'erase') && isSuperadmin) {
        const m = mouseToCell(e.clientX, e.clientY);
        if (m) {
          const stamp = brushChunks(m.cx, m.cz);
          const fresh = stamp.filter(c => !drag.paintedThisDrag.has(`${c.cx},${c.cz}`));
          if (fresh.length > 0) {
            for (const c of fresh) drag.paintedThisDrag.add(`${c.cx},${c.cz}`);
            if (drag.mode === 'paint') void paintChunks(fresh);
            else void eraseChunks(fresh);
          }
        }
      }
    }
    // Tooltip
    const t = findTreeNearMouse(e.clientX, e.clientY);
    if (t) {
      // Only show tooltip if admin OR the tree is the user's own.
      const allowed = isAdmin || t.ownerUserId === currentUserId;
      if (allowed) {
        setHover({ screenX: e.clientX, screenY: e.clientY, tree: t });
        return;
      }
    }
    setHover(null);
  }, [findTreeNearMouse, isAdmin, currentUserId, layout, isSuperadmin, mouseToCell, brushChunks, paintChunks, eraseChunks]);

  const onMouseUp = useCallback(() => {
    dragRef.current.active = false;
    dragRef.current.lastMouse = null;
    dragRef.current.paintedThisDrag.clear();
  }, []);
  const onMouseLeave = useCallback(() => {
    dragRef.current.active = false;
    setHover(null);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="God Map"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90%', height: '95%',
          background: 'hsla(var(--hud-bg))',
          border: '2px solid hsla(var(--hud-border))',
          borderRadius: 'var(--hud-radius)',
          position: 'relative',
          overflow: 'hidden',
          color: 'hsl(var(--hud-text))',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid hsla(var(--hud-border))' }}>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>God Map</div>
          <div style={{ marginLeft: '12px', fontSize: '11px', color: 'hsl(var(--hud-text-dim))' }}>
            {loading
              ? 'loading…'
              : `${trees.length} trees · ${noPlant.size} no-plant chunks${bounds ? ` · chunks (${bounds.minChunkX}..${bounds.maxChunkX}, ${bounds.minChunkZ}..${bounds.maxChunkZ})` : ''}`}
          </div>
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto', cursor: 'pointer',
              background: 'transparent', border: '1px solid hsla(var(--hud-border))',
              color: 'hsl(var(--hud-text))', borderRadius: '4px',
              padding: '2px 8px', fontSize: '12px',
            }}
          >✕</button>
        </div>

        {/* Map canvas */}
        <div
          ref={containerRef}
          style={{ position: 'absolute', inset: '36px 0 0 0', overflow: 'hidden' }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            style={{
              display: 'block',
              cursor: tool === 'pan' ? 'grab' : tool === 'paint' ? 'crosshair' : 'cell',
              width: '100%', height: '100%',
            }}
          />
        </div>

        {/* Tooltip */}
        {hover && hover.tree && (
          <div
            style={{
              position: 'fixed',
              left: Math.min(hover.screenX + 12, window.innerWidth - 240),
              top: Math.min(hover.screenY + 12, window.innerHeight - 110),
              background: 'hsla(var(--hud-bg))',
              border: '1px solid hsla(var(--hud-border))',
              borderRadius: 'var(--hud-radius)',
              padding: '8px 10px',
              fontSize: '12px',
              minWidth: '200px',
              pointerEvents: 'none',
              zIndex: 9100,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '2px' }}>
              {hover.tree.treeType.charAt(0).toUpperCase() + hover.tree.treeType.slice(1)} Tree T{hover.tree.tier}
            </div>
            <div style={{ color: 'hsl(var(--hud-text-dim))' }}>
              Owner: {hover.tree.ownerDisplayName || hover.tree.ownerUserId.slice(0, 8)}
            </div>
            <div style={{ color: 'hsl(var(--hud-text-dim))' }}>
              Blocks: {hover.tree.blockCount.toLocaleString()}
            </div>
            <div style={{ color: 'hsl(var(--hud-text-dim))' }}>
              Pos: ({hover.tree.baseX}, {hover.tree.baseY}, {hover.tree.baseZ})
            </div>
          </div>
        )}

        {/* Tool sub-panel — middle right */}
        <div
          style={{
            position: 'absolute', right: '12px', top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex', flexDirection: 'column', gap: '6px',
            background: 'hsla(var(--hud-bg))',
            border: '1px solid hsla(var(--hud-border))',
            borderRadius: 'var(--hud-radius)',
            padding: '8px',
          }}
        >
          {/* Zoom */}
          <button
            onClick={() => setZoomLevel(z => z === 'chunk' ? 'voxel' : 'chunk')}
            style={toolButtonStyle(false)}
            title="Toggle zoom (chunk / voxel)"
          >{zoomLevel === 'chunk' ? '+' : '−'}</button>

          {/* Pan */}
          <button onClick={() => setTool('pan')} style={toolButtonStyle(tool === 'pan')} title="Pan (drag)">
            ✋
          </button>

          {/* Superadmin-only paint/erase + brush width */}
          {isSuperadmin && (
            <>
              <button onClick={() => setTool('paint')} style={toolButtonStyle(tool === 'paint')} title="Paint no-plant zone">
                🖌
              </button>
              <button onClick={() => setTool('erase')} style={toolButtonStyle(tool === 'erase')} title="Erase no-plant zone">
                🧽
              </button>
              <div style={{ display: 'flex', gap: '2px', justifyContent: 'center' }}>
                {[1, 2, 3].map(n => (
                  <button
                    key={n}
                    onClick={() => setBrushWidth(n as 1 | 2 | 3)}
                    style={{ ...toolButtonStyle(brushWidth === n), padding: '2px 6px', minWidth: 'auto' }}
                    title={`Brush ${n}-wide`}
                  >{n}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function toolButtonStyle(active: boolean): React.CSSProperties {
  // Brand-correct: active uses the existing HUD highlight border,
  // inactive uses the HUD dim background. No off-brand greens/yellows.
  return {
    cursor: 'pointer',
    background: active ? 'hsla(var(--hud-bg))' : 'hsla(var(--hud-bg-dim))',
    border: active
      ? '2px solid hsla(var(--hud-highlight))'
      : '1px solid hsla(var(--hud-border))',
    color: 'hsl(var(--hud-text))',
    borderRadius: 'var(--hud-radius)',
    padding: '6px 10px',
    fontSize: '14px',
    minWidth: '36px',
  };
}
