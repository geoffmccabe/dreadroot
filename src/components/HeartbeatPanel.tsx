// Heartbeat (HB) Panel — Live architectural flowchart of the game loop
// Shows every step, check, and decision the game makes each frame
// Toggle with Ctrl+H

import React, { useState, useEffect, useRef } from 'react';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { frameLoop } from '@/lib/frameLoop';

// Colors for different line types
const C = {
  header: '#60a5fa',    // blue - section headers
  step: '#d1d5db',      // light gray - normal steps
  value: '#34d399',     // green - live values
  cond: '#fbbf24',      // amber - if/then conditions
  warn: '#f87171',      // red - warnings/overflow
  dim: '#6b7280',       // dim gray - inactive/disabled
  label: '#a78bfa',     // purple - labels
};

function line(indent: number, color: string, text: string): string {
  const prefix = indent === 0 ? '' : '│ '.repeat(indent - 1) + '├─ ';
  return `<span style="color:${color}">${prefix}${text}</span>`;
}

function lastLine(indent: number, color: string, text: string): string {
  const prefix = indent === 0 ? '' : '│ '.repeat(indent - 1) + '└─ ';
  return `<span style="color:${color}">${prefix}${text}</span>`;
}

function val(v: number | string): string {
  return `<span style="color:${C.value};font-weight:bold">${v}</span>`;
}

function warn(v: number | string): string {
  return `<span style="color:${C.warn};font-weight:bold">${v}</span>`;
}

export function HeartbeatPanel() {
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState('');
  const intervalRef = useRef<number | null>(null);

  // Toggle with Ctrl+H
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'KeyH') {
        e.preventDefault();
        setVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Update content every 500ms when visible
  useEffect(() => {
    if (!visible) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const update = () => {
      const d = diagnostics;
      const lines: string[] = [];

      const fps = d.currentFps || 0;
      const fpsColor = fps >= 90 ? C.value : fps >= 60 ? '#fbbf24' : C.warn;

      // ═══════════════════════════════════════
      // HEADER
      // ═══════════════════════════════════════
      lines.push(`<span style="color:${C.header};font-weight:bold;font-size:14px">♥ HEARTBEAT — Game Loop Flow</span>`);
      lines.push(`<span style="color:${C.dim}">Updated every 500ms. Current FPS: </span><span style="color:${fpsColor};font-weight:bold">${fps}</span>`);
      lines.push('');

      // ═══════════════════════════════════════
      // FRAME LOOP (runs every frame ~11ms for 90FPS)
      // ═══════════════════════════════════════
      lines.push(line(0, C.header, '━━━ EVERY FRAME (target: 11ms for 90 FPS) ━━━'));

      // Get frameLoop callback list
      const flCallbacks = (window as any).frameLoop?.getTimingReport?.() || [];
      const topCallbacks = flCallbacks.slice(0, 6);

      lines.push(line(1, C.step, `Frame Loop runs ${val(topCallbacks.length + '+')} registered callbacks:`));
      for (const cb of topCallbacks) {
        lines.push(line(2, C.step, `${cb.id}: ${val(cb.time.toFixed(1) + 'ms')} total`));
      }
      if (flCallbacks.length > 6) {
        lines.push(lastLine(2, C.dim, `...and ${flCallbacks.length - 6} more`));
      }
      lines.push('');

      lines.push(line(1, C.step, `Controls: process mouse/keyboard input`));
      lines.push(line(1, C.step, `Camera: update position, check chunk boundary`));
      lines.push(line(2, C.cond, `IF crossed chunk boundary → trigger chunk load/unload`));
      lines.push(lastLine(2, C.cond, `IF same chunk → skip (throttled to 200ms)`));
      lines.push('');

      lines.push(line(1, C.step, `Enemy AI: tick enemies by LOD distance`));
      lines.push(line(2, C.step, `Full LOD (nearby): ${val(d.enemiesFullLOD)} enemies`));
      lines.push(line(2, C.step, `Throttled (medium): ${val(d.enemiesThrottled)} enemies`));
      lines.push(lastLine(2, C.step, `Frozen (distant): ${val(d.enemiesFrozen)} enemies`));
      lines.push('');

      lines.push(line(1, C.step, `Budgeted Work: colliders + mesh rebuilds`));
      lines.push(line(2, C.step, `Collider batch: 200 per frame tick (2ms budget)`));
      lines.push(lastLine(2, C.step, `Mesh rebuild: 2000 blocks per frame (4ms budget)`));
      lines.push('');

      lines.push(line(1, C.step, `Three.js Render`));
      lines.push(line(2, C.step, `Draw calls: ${val(d.drawCalls)}`));
      lines.push(line(2, C.step, `Triangles: ${val(Math.round(d.triangles / 1000) + 'K')}`));
      lines.push(lastLine(2, C.step, `Render time: ${val(d.timeRender.toFixed(2) + 'ms')}`));
      lines.push('');

      // ═══════════════════════════════════════
      // CHUNK LOADING PIPELINE (on demand)
      // ═══════════════════════════════════════
      lines.push(line(0, C.header, '━━━ CHUNK LOADING (on boundary cross / init) ━━━'));

      lines.push(line(1, C.step, `1. Mutex: serialize — only one load runs at a time`));
      lines.push(line(2, C.cond, `IF another load is running → queue behind it`));
      lines.push(lastLine(2, C.cond, `IF free → proceed immediately`));
      lines.push('');

      lines.push(line(1, C.step, `2. Pre-eviction: remove distant chunks to make room`));
      lines.push(line(2, C.step, `Unload chunks beyond UNLOAD_RADIUS of player`));
      lines.push(lastLine(2, C.step, `LRU evict if still over MAX_LOADED_CHUNKS`));
      lines.push('');

      lines.push(line(1, C.step, `3. Check cap: loaded ${val(d.loadedChunkCount)} / max ~339`));
      const overCap = d.loadedChunkCount > 339;
      if (overCap) {
        lines.push(lastLine(2, C.warn, `⚠ OVER CAP — skip loading until eviction clears space`));
      } else {
        lines.push(lastLine(2, C.value, `✓ Under cap — ${339 - d.loadedChunkCount} slots available`));
      }
      lines.push('');

      lines.push(line(1, C.step, `4. Filter: skip already-loaded chunks`));
      lines.push(line(1, C.step, `5. Cache check: read IndexedDB for cached blocks`));
      lines.push(line(2, C.cond, `IF cache hit + fresh (<30s) → use directly, skip server`));
      lines.push(line(2, C.cond, `IF cache hit + stale → check version with server`));
      lines.push(lastLine(2, C.cond, `IF cache miss → fetch from server via RPC`));
      lines.push('');

      lines.push(line(1, C.step, `6. Fetch: batched RPC (50 chunks per call)`));
      lines.push(line(2, C.step, `Server filters expired blocks, omits unused columns`));
      lines.push(lastLine(2, C.step, `Returns all blocks for batch in single response`));
      lines.push('');

      lines.push(line(1, C.step, `7. Process: sorted by distance (nearest first)`));
      lines.push(line(2, C.step, `Batch of 10 chunks at a time:`));
      lines.push(line(3, C.step, `Sort blocks deterministically`));
      lines.push(line(3, C.step, `Compute surface-visible blocks (cull interior)`));
      lines.push(line(3, C.step, `Create colliders (sync if dist ≤ 1, else budgeted)`));
      lines.push(line(3, C.step, `Store in loadedChunksRef`));
      lines.push(line(3, C.step, `Emit → triggers React to render these chunks`));
      lines.push(lastLine(3, C.step, `Yield (RAF) → let game render a frame`));
      lines.push('');

      lines.push(line(1, C.step, `8. Post-load: evict if over cap, save to IndexedDB cache`));
      lines.push(lastLine(1, C.step, `9. Release mutex → next queued load can start`));
      lines.push('');

      // ═══════════════════════════════════════
      // CHUNK RENDERING PIPELINE (React)
      // ═══════════════════════════════════════
      lines.push(line(0, C.header, '━━━ CHUNK RENDERING (React, on worldRevision change) ━━━'));

      lines.push(line(1, C.step, `1. CameraTrackedBlocks: classify loaded chunks`));
      lines.push(line(2, C.step, `Normal (within visual distance): render with atlas`));
      lines.push(line(2, C.step, `Fade (visual dist +1 to +3): grey silhouettes`));
      lines.push(lastLine(2, C.step, `Beyond range: skip (not rendered)`));
      lines.push('');

      lines.push(line(1, C.step, `2. ChunkRenderer (React.memo): one per visible chunk`));
      lines.push(line(2, C.cond, `IF blocks ref unchanged → skip re-render (memo hit)`));
      lines.push(lastLine(2, C.cond, `IF blocks ref changed → re-render PlacedBlocks`));
      lines.push('');

      lines.push(line(1, C.step, `3. PlacedBlocks: group blocks by type`));
      lines.push(line(2, C.step, `Tree blocks → single InstancedAtlasBlockGroup (1 draw call)`));
      lines.push(line(2, C.step, `Non-tree blocks → InstancedBlockGroup per type`));
      lines.push(line(2, C.cond, `IF grouping cache hit → skip regrouping`));
      lines.push(lastLine(2, C.cond, `IF cache miss → regroup all blocks in chunk`));
      lines.push('');

      lines.push(line(1, C.step, `4. Mesh rebuild: compute instance data`));
      lines.push(line(2, C.step, `Per block: matrix position, UV offset, color`));
      lines.push(line(2, C.cond, `IF < 1000 blocks → sync rebuild (~1ms)`));
      lines.push(lastLine(2, C.cond, `IF ≥ 1000 blocks → budgeted RAF loop (2000/frame, 4ms cap)`));
      lines.push('');

      // ═══════════════════════════════════════
      // CURRENT STATE
      // ═══════════════════════════════════════
      lines.push(line(0, C.header, '━━━ CURRENT STATE ━━━'));

      lines.push(line(1, C.label, `Player chunk: ${val(`(${d.playerChunkX}, ${d.playerChunkZ})`)}`));
      lines.push(line(1, C.label, `Loaded chunks: ${val(d.loadedChunkCount)} (${val(d.totalLoadedBlocks)} blocks)`));
      lines.push(line(1, C.label, `Visible chunks: ${val(d.visibleChunkCount)} (${val(d.totalVisibleBlocks)} surface blocks)`));
      lines.push(line(1, C.label, `Rendered chunks: ${val(d.renderedChunkCount)}`));
      lines.push(line(1, C.label, `World grid: ${val(d.worldGridSize)} colliders`));
      lines.push(line(1, C.label, `Entity grid: ${val(d.entityGridSize)} entries`));
      lines.push(line(1, C.label, `Draw calls: ${val(d.drawCalls)}`));

      const mem = (performance as any).memory;
      if (mem) {
        const usedMB = Math.round(mem.usedJSHeapSize / 1048576);
        const limitMB = Math.round(mem.jsHeapSizeLimit / 1048576);
        const pct = Math.round((usedMB / limitMB) * 100);
        const memColor = pct > 80 ? C.warn : pct > 60 ? '#fbbf24' : C.value;
        lines.push(line(1, C.label, `Memory: <span style="color:${memColor}">${usedMB}MB / ${limitMB}MB (${pct}%)</span>`));
      }

      lines.push('');
      lines.push(line(1, C.label, `Enemies: ${val(d.shwarmCount)} shwarms, ${val(d.shnakeCount)} shnakes, ${val(d.shombieCount)} shombies`));
      lines.push(lastLine(1, C.label, `GPU texture mem: ${val(d.gpuTextureMemMB.toFixed(0) + 'MB')}`));

      // ═══════════════════════════════════════
      // INTEGRITY / SAFETY
      // ═══════════════════════════════════════
      lines.push('');
      lines.push(line(0, C.header, '━━━ BACKGROUND SYSTEMS ━━━'));

      lines.push(line(1, C.step, `Integrity check: every 5s, finds missing chunks in radius`));
      lines.push(line(2, C.cond, `IF missing chunks found → queue load via mutex`));
      lines.push(lastLine(2, C.cond, `IF all present → no action`));
      lines.push('');

      lines.push(line(1, C.dim, `Prefetch: DISABLED (velocity-based, loads ahead of movement)`));
      lines.push(line(1, C.step, `IndexedDB cache: 7-day retention, auto-cleanup on startup`));
      lines.push(line(1, C.step, `Chunk versions: realtime subscription, refetch on change`));
      lines.push(lastLine(1, C.step, `DoT ticks: via frameLoop (100ms throttle)`));

      setHtml(lines.join('\n'));
    };

    update();
    intervalRef.current = window.setInterval(update, 500);
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '520px',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        color: '#d1d5db',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: '11px',
        lineHeight: '1.5',
        padding: '12px 16px',
        overflowY: 'auto',
        zIndex: 99999,
        borderLeft: '1px solid #374151',
        whiteSpace: 'pre',
        pointerEvents: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <div style={{ color: '#6b7280', marginTop: '12px', fontSize: '10px' }}>
        Press Ctrl+H to close
      </div>
    </div>
  );
}
