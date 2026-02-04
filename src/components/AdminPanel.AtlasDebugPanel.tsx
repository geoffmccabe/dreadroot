import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { atlasManager, SLOT_RANGES } from '@/lib/atlasManager';
import { ATLAS_GRID_SIZE, ATLAS_TOTAL_SLOTS } from '@/lib/textureAtlas';
import type { AtlasSlotMetadata } from '@/lib/atlasStorage';

const DISPLAY_SIZE = 512;
const CELL_SIZE = DISPLAY_SIZE / ATLAS_GRID_SIZE; // 16px per slot

// Category colors for headers and highlights
const CATEGORY_COLORS: Record<string, string> = {
  tree: '#4ade80',
  shwarm: '#f97316',
  shombie: '#ef4444',
  shnake: '#a855f7',
  walapa: '#3b82f6',
  global: '#facc15',
  block: '#78716c',
  fungal_tree: '#22d3ee',
  misc: '#94a3b8',
};

function getCategoryForSlot(slotIndex: number): string | null {
  for (const [cat, range] of Object.entries(SLOT_RANGES)) {
    if (slotIndex >= range.start && slotIndex <= range.end) return cat;
  }
  return null;
}

export function AtlasDebugPanel() {
  const atlasCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [slots, setSlots] = useState<Record<number, AtlasSlotMetadata>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const tableRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Capture atlas canvas and metadata
  useEffect(() => {
    const canvas = atlasManager.getCanvas();
    const displayCanvas = atlasCanvasRef.current;
    if (!canvas || !displayCanvas) return;

    const ctx = displayCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    ctx.drawImage(canvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= ATLAS_GRID_SIZE; i++) {
      const p = i * CELL_SIZE;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, DISPLAY_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(DISPLAY_SIZE, p);
      ctx.stroke();
    }

    const meta = atlasManager.getMetadata();
    setSlots(meta?.slots ?? {});
  }, [refreshKey]);

  // Draw overlay highlight
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);

    if (hoveredSlot !== null && hoveredSlot >= 0 && hoveredSlot < ATLAS_TOTAL_SLOTS) {
      const col = hoveredSlot % ATLAS_GRID_SIZE;
      const row = Math.floor(hoveredSlot / ATLAS_GRID_SIZE);
      const x = col * CELL_SIZE;
      const y = row * CELL_SIZE;

      ctx.strokeStyle = '#ff0';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

      // Slot number label
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x, y - 14, 40, 14);
      ctx.fillStyle = '#ff0';
      ctx.font = '10px monospace';
      ctx.fillText(`#${hoveredSlot}`, x + 2, y - 3);
    }
  }, [hoveredSlot]);

  // Scroll table row into view on hover
  useEffect(() => {
    if (hoveredSlot !== null) {
      const rowEl = tableRowRefs.current.get(hoveredSlot);
      rowEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [hoveredSlot]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / CELL_SIZE);
    const row = Math.floor(y / CELL_SIZE);
    if (col >= 0 && col < ATLAS_GRID_SIZE && row >= 0 && row < ATLAS_GRID_SIZE) {
      setHoveredSlot(row * ATLAS_GRID_SIZE + col);
    }
  }, []);

  const handleMouseLeave = useCallback(() => setHoveredSlot(null), []);

  // Build category groups with slot data
  const categoryGroups = useMemo(() => {
    const groups: Array<{
      name: string;
      color: string;
      start: number;
      end: number;
      usedCount: number;
      rows: Array<{ slot: number; meta: AtlasSlotMetadata | null }>;
    }> = [];

    for (const [cat, range] of Object.entries(SLOT_RANGES)) {
      const rows: Array<{ slot: number; meta: AtlasSlotMetadata | null }> = [];
      let usedCount = 0;

      for (let s = range.start; s <= range.end; s++) {
        const meta = slots[s] || null;
        if (meta) usedCount++;
        rows.push({ slot: s, meta });
      }

      groups.push({
        name: cat,
        color: CATEGORY_COLORS[cat] || '#888',
        start: range.start,
        end: range.end,
        usedCount,
        rows,
      });
    }

    return groups;
  }, [slots]);

  const handleRefresh = () => setRefreshKey(k => k + 1);

  const handleClearCache = async () => {
    await atlasManager.clear();
    setRefreshKey(k => k + 1);
  };

  // Tooltip text for hovered slot
  const tooltipText = hoveredSlot !== null ? (
    slots[hoveredSlot]
      ? `#${hoveredSlot}: ${slots[hoveredSlot].id}`
      : `#${hoveredSlot}: (empty)`
  ) : null;

  return (
    <div className="space-y-4">
      {/* Category Summary */}
      <Card className="p-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {categoryGroups.map(g => (
            <span key={g.name} className="px-2 py-1 rounded font-mono" style={{ backgroundColor: g.color + '22', color: g.color, border: `1px solid ${g.color}44` }}>
              {g.name}: {g.usedCount}/{g.end - g.start + 1}
            </span>
          ))}
        </div>
      </Card>

      {/* Main content: atlas grid + table */}
      <div className="flex gap-4">
        {/* Left: Atlas canvas */}
        <div className="flex-shrink-0">
          <Card className="p-2">
            <div className="relative" style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }}>
              <canvas
                ref={atlasCanvasRef}
                width={DISPLAY_SIZE}
                height={DISPLAY_SIZE}
                className="absolute top-0 left-0"
                style={{ imageRendering: 'pixelated' }}
              />
              <canvas
                ref={overlayCanvasRef}
                width={DISPLAY_SIZE}
                height={DISPLAY_SIZE}
                className="absolute top-0 left-0 cursor-crosshair"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
            </div>
            {tooltipText && (
              <div className="mt-1 text-xs font-mono text-muted-foreground truncate max-w-[512px]">
                {tooltipText}
              </div>
            )}
          </Card>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={handleRefresh}>Refresh</Button>
            <Button size="sm" variant="destructive" onClick={handleClearCache}>Clear Cache</Button>
          </div>
        </div>

        {/* Right: Slot table */}
        <div className="flex-1 min-w-0">
          <Card className="p-0 h-[560px]">
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {categoryGroups.map(group => (
                  <div key={group.name}>
                    {/* Category header */}
                    <div
                      className="sticky top-0 z-10 px-2 py-1 font-bold text-xs uppercase tracking-wider rounded"
                      style={{ backgroundColor: group.color + '22', color: group.color }}
                    >
                      {group.name} ({group.usedCount}/{group.end - group.start + 1}) &mdash; slots {group.start}-{group.end}
                    </div>

                    {/* Slot rows — only show populated slots + a summary for empty ranges */}
                    {renderCategoryRows(group, hoveredSlot, setHoveredSlot, tableRowRefs)}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Render rows for a category, collapsing large empty ranges */
function renderCategoryRows(
  group: {
    name: string;
    rows: Array<{ slot: number; meta: AtlasSlotMetadata | null }>;
    start: number;
    end: number;
  },
  hoveredSlot: number | null,
  setHoveredSlot: (s: number | null) => void,
  tableRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>
) {
  const elements: JSX.Element[] = [];
  let emptyRunStart: number | null = null;
  let emptyRunCount = 0;

  const flushEmptyRun = () => {
    if (emptyRunStart !== null && emptyRunCount > 0) {
      if (emptyRunCount <= 3) {
        // Show individual empty rows
        for (let i = 0; i < emptyRunCount; i++) {
          const s = emptyRunStart + i;
          elements.push(
            <SlotRow key={s} slot={s} meta={null} isHovered={hoveredSlot === s}
              onHover={setHoveredSlot} refMap={tableRowRefs} />
          );
        }
      } else {
        elements.push(
          <div key={`empty-${emptyRunStart}`} className="px-2 py-0.5 text-xs text-muted-foreground/50 italic">
            ... {emptyRunCount} empty slots ({emptyRunStart}-{emptyRunStart + emptyRunCount - 1})
          </div>
        );
      }
      emptyRunStart = null;
      emptyRunCount = 0;
    }
  };

  for (const row of group.rows) {
    if (row.meta) {
      flushEmptyRun();
      elements.push(
        <SlotRow key={row.slot} slot={row.slot} meta={row.meta}
          isHovered={hoveredSlot === row.slot}
          onHover={setHoveredSlot} refMap={tableRowRefs} />
      );
    } else {
      if (emptyRunStart === null) emptyRunStart = row.slot;
      emptyRunCount++;
    }
  }
  flushEmptyRun();

  return elements;
}

function SlotRow({
  slot, meta, isHovered, onHover, refMap
}: {
  slot: number;
  meta: AtlasSlotMetadata | null;
  isHovered: boolean;
  onHover: (s: number | null) => void;
  refMap: React.MutableRefObject<Map<number, HTMLDivElement>>;
}) {
  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (el) refMap.current.set(slot, el);
    else refMap.current.delete(slot);
  }, [slot, refMap]);

  return (
    <div
      ref={setRef}
      className={`flex items-center gap-2 px-2 py-0.5 text-xs font-mono rounded cursor-pointer transition-colors ${
        isHovered ? 'bg-yellow-500/20 ring-1 ring-yellow-500/40' : 'hover:bg-muted/50'
      }`}
      onMouseEnter={() => onHover(slot)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="w-8 text-right text-muted-foreground">{slot}</span>
      {meta ? (
        <>
          <span className="flex-1 truncate">{meta.id}</span>
          {meta.type === 'animated' && (
            <span className="px-1 rounded bg-purple-500/20 text-purple-400 text-[10px]">
              {meta.frameCount}f
            </span>
          )}
          <span className="max-w-[120px] truncate text-muted-foreground/60 text-[10px]">
            {meta.sourceUrl ? new URL(meta.sourceUrl, 'https://x').pathname.split('/').pop() : 'placeholder'}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground/30 italic">(empty)</span>
      )}
    </div>
  );
}
