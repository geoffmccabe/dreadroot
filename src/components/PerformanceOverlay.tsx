// DF (Data Flow) - Unified Performance Diagnostics Panel
// Single panel for all FPS/performance troubleshooting
// Toggle with Shift+3 (#)

import { useEffect, useState, useRef } from 'react';
import { diagnostics } from '@/lib/diagnosticsLogger';

interface PerformanceData {
  fps: number;
  frameTime: number;
  controls: number;
  enemyAI: number;
  blocks: number;
  render: number;
  trees: number;
  particles: number;
  bullets: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  worldGrid: number;
  entityGrid: number;
  enemyCount: number;
  shwarmCount: number;
  shwarmBlockCount: number;
  shnakeCount: number;
  shnakeSegmentCount: number;
  shombieCount: number;
  visibleBlocks: number;
  particleCount: number;
  memory?: number;
  memoryTotal?: number;
  gridCacheHitRate: number;
  // Chunk rendering (Phase 0)
  chunkRenderCount: number;
  chunkRebuilds: number;
  chunkRebuildMs: number;
  globalFlattenMs: number;
  meshInstanceTotal: number;
  gpuTextureMemMB: number;
  groupMisses: number;
  groupMs: number;
  meshRebuilds: number;
  meshRebuildMs: number;
  // Session accumulated stats
  sampleCount: number;
  duration: number;
  avgFps: number;
  minFps: number;
  maxFps: number;
  below30Pct: number;
  maxDrawCalls: number;
  maxWorldGrid: number;
  maxEntityGrid: number;
  longFrames: number;
  maxFrameTime: number;
}

export function PerformanceOverlay() {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [data, setData] = useState<PerformanceData>({
    fps: 0,
    frameTime: 0,
    controls: 0,
    enemyAI: 0,
    blocks: 0,
    render: 0,
    trees: 0,
    particles: 0,
    bullets: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    worldGrid: 0,
    entityGrid: 0,
    enemyCount: 0,
    shwarmCount: 0,
    shwarmBlockCount: 0,
    shnakeCount: 0,
    shnakeSegmentCount: 0,
    shombieCount: 0,
    visibleBlocks: 0,
    particleCount: 0,
    gridCacheHitRate: 0,
    chunkRenderCount: 0,
    chunkRebuilds: 0,
    chunkRebuildMs: 0,
    globalFlattenMs: 0,
    meshInstanceTotal: 0,
    gpuTextureMemMB: 0,
    groupMisses: 0,
    groupMs: 0,
    meshRebuilds: 0,
    meshRebuildMs: 0,
    sampleCount: 0,
    duration: 0,
    avgFps: 0,
    minFps: 0,
    maxFps: 0,
    below30Pct: 0,
    maxDrawCalls: 0,
    maxWorldGrid: 0,
    maxEntityGrid: 0,
    longFrames: 0,
    maxFrameTime: 0,
  });
  
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const frameTimesRef = useRef<number[]>([]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shift+3 (#) toggles this panel visibility only
      // D-Flow recording is toggled by Fortress.tsx to avoid double-toggle
      if (e.shiftKey && e.key === '#') {
        setVisible(prev => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  useEffect(() => {
    if (!visible) return;
    
    let animationId: number;
    let lastFrameTime = performance.now();
    
    const measure = () => {
      const now = performance.now();
      const frameTime = now - lastFrameTime;
      lastFrameTime = now;
      
      frameCountRef.current++;
      frameTimesRef.current.push(frameTime);
      if (frameTimesRef.current.length > 60) {
        frameTimesRef.current.shift();
      }
      
      // Update display every 500ms
      if (now - lastTimeRef.current >= 500) {
        const elapsed = now - lastTimeRef.current;
        const fps = (frameCountRef.current / elapsed) * 1000;
        const avgFrameTime = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
        
        // Get diagnostics data
        const d = diagnostics;
        
        // Calculate cache hit rate
        const totalQueries = d.gridCacheHits + d.gridCacheMisses;
        const hitRate = totalQueries > 0 ? (d.gridCacheHits / totalQueries) * 100 : 0;

        // Get chunk rendering stats
        const extra = d.getExtraStats();

        // Calculate session accumulated stats from buffer
        const n = Math.min(d.ticker, 600);
        let fpsSum = 0, fpsMin = Infinity, fpsMax = 0;
        let below30Count = 0;
        let maxDrawCalls = 0;
        let maxWorldGrid = 0, maxEntityGrid = 0;
        let longFrameTotal = 0, maxFrameTime = 0;

        for (let s = 0; s < n; s++) {
          const i = s * 50;
          const sampleFps = d.buffer[i + 1];
          fpsSum += sampleFps;
          if (sampleFps < fpsMin) fpsMin = sampleFps;
          if (sampleFps > fpsMax) fpsMax = sampleFps;
          if (sampleFps < 30) below30Count++;
          if (d.buffer[i + 32] > maxDrawCalls) maxDrawCalls = d.buffer[i + 32];
          if (d.buffer[i + 44] > maxWorldGrid) maxWorldGrid = d.buffer[i + 44];
          if (d.buffer[i + 45] > maxEntityGrid) maxEntityGrid = d.buffer[i + 45];
          longFrameTotal += d.buffer[i + 48];
          if (d.buffer[i + 49] > maxFrameTime) maxFrameTime = d.buffer[i + 49];
        }

        setData({
          fps: Math.round(fps),
          frameTime: avgFrameTime,
          controls: d.timeControls,
          enemyAI: d.timeEnemyAI,
          blocks: d.timeBlocks,
          render: d.timeRender,
          trees: d.timeTrees,
          particles: d.timeParticles,
          bullets: d.timeBullets,
          drawCalls: d.drawCalls,
          triangles: d.triangles,
          geometries: d.geometries,
          textures: d.textures,
          worldGrid: d.worldGridSize,
          entityGrid: d.entityGridSize,
          enemyCount: d.enemyCount,
          shwarmCount: d.shwarmCount,
          shwarmBlockCount: d.shwarmBlockCount,
          shnakeCount: d.shnakeCount,
          shnakeSegmentCount: d.shnakeSegmentCount,
          shombieCount: d.shombieCount,
          visibleBlocks: d.visibleBlocks,
          particleCount: d.particleCount,
          memory: d.jsHeapUsed || undefined,
          memoryTotal: d.jsHeapTotal || undefined,
          gridCacheHitRate: hitRate,
          chunkRenderCount: extra.chunkRenderCount,
          chunkRebuilds: extra.chunkRebuildCountTotal,
          chunkRebuildMs: extra.chunkRebuildMsTotal,
          globalFlattenMs: extra.globalFlattenMsTotal,
          meshInstanceTotal: extra.meshInstanceTotal,
          gpuTextureMemMB: extra.gpuTextureMemMB,
          groupMisses: extra.groupCacheMissesTotal,
          groupMs: extra.groupMsTotal,
          meshRebuilds: extra.meshRebuildCountTotal,
          meshRebuildMs: extra.meshRebuildMsTotal,
          sampleCount: n,
          duration: d.elapsedSeconds,
          avgFps: n > 0 ? fpsSum / n : 0,
          minFps: n > 0 ? fpsMin : 0,
          maxFps: n > 0 ? fpsMax : 0,
          below30Pct: n > 0 ? (below30Count / n) * 100 : 0,
          maxDrawCalls,
          maxWorldGrid,
          maxEntityGrid,
          longFrames: longFrameTotal,
          maxFrameTime,
        });
        
        // Reset counters
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
      
      animationId = requestAnimationFrame(measure);
    };
    
    animationId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(animationId);
  }, [visible]);
  
  if (!visible) return null;
  
  const fpsColor = data.fps >= 55 ? 'text-green-400' : data.fps >= 30 ? 'text-yellow-400' : 'text-red-400';
  const avgFpsColor = data.avgFps >= 55 ? 'text-green-400' : data.avgFps >= 30 ? 'text-yellow-400' : 'text-red-400';
  const gridColor = data.worldGrid > 5000 ? 'text-red-400' : data.worldGrid > 2000 ? 'text-yellow-400' : 'text-gray-400';

  // Identify potential issues for the report
  const getIssues = () => {
    const issues: string[] = [];
    if (data.avgFps < 30) issues.push('LOW FPS: Average below 30');
    if (data.below30Pct > 10) issues.push(`FRAME DROPS: ${data.below30Pct.toFixed(1)}% of frames below 30 FPS`);
    if (data.maxFrameTime > 50) issues.push(`LONG FRAMES: Max frame time ${data.maxFrameTime.toFixed(0)}ms (${data.longFrames} long frames)`);
    if (data.maxDrawCalls > 500) issues.push(`HIGH DRAW CALLS: Peak ${data.maxDrawCalls}`);
    if (data.maxWorldGrid > 5000) issues.push(`LARGE WORLD GRID: Peak ${data.maxWorldGrid} entries`);
    if (data.enemyAI > 10) issues.push(`SLOW ENEMY AI: ${data.enemyAI.toFixed(1)}ms per 100ms`);
    if (data.render > 15) issues.push(`SLOW RENDER: ${data.render.toFixed(1)}ms per 100ms`);
    if (data.gridCacheHitRate < 50 && data.sampleCount > 10) issues.push(`LOW CACHE HIT: ${data.gridCacheHitRate.toFixed(0)}%`);
    return issues;
  };

  const handleCopy = () => {
    const issues = getIssues();
    const timestamp = new Date().toISOString();

    let text = `=== DF (Data Flow) Performance Report ===
Generated: ${timestamp}
Session: ${data.duration}s (${data.sampleCount} samples @ 100ms intervals)

${issues.length > 0 ? `⚠️ POTENTIAL ISSUES DETECTED:\n${issues.map(i => `  • ${i}`).join('\n')}\n` : '✓ No obvious issues detected\n'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FPS ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Current FPS:    ${data.fps}
  Average FPS:    ${data.avgFps.toFixed(1)}
  Min FPS:        ${data.minFps.toFixed(0)}
  Max FPS:        ${data.maxFps.toFixed(0)}
  Below 30 FPS:   ${data.below30Pct.toFixed(1)}% of samples
  Frame Time:     ${data.frameTime.toFixed(1)}ms (current)
  Max Frame:      ${data.maxFrameTime.toFixed(0)}ms
  Long Frames:    ${data.longFrames} (>33ms)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SYSTEM TIMING (ms per 100ms sample)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Controls:   ${data.controls.toFixed(2)}ms
  Enemy AI:   ${data.enemyAI.toFixed(2)}ms
  Blocks:     ${data.blocks.toFixed(2)}ms
  Trees:      ${data.trees.toFixed(2)}ms
  Particles:  ${data.particles.toFixed(2)}ms
  Bullets:    ${data.bullets.toFixed(2)}ms
  Render:     ${data.render.toFixed(2)}ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GPU & RENDERING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Draw Calls:     ${data.drawCalls} (max: ${data.maxDrawCalls})
  Triangles:      ${(data.triangles / 1000).toFixed(1)}K
  Geometries:     ${data.geometries}
  Textures:       ${data.textures}
  Visible Blocks: ${data.visibleBlocks}
  Particles:      ${data.particleCount}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COLLISION & SPATIAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  World Grid:     ${data.worldGrid} (max: ${data.maxWorldGrid})
  Entity Grid:    ${data.entityGrid} (max: ${data.maxEntityGrid})
  Cache Hit Rate: ${data.gridCacheHitRate.toFixed(0)}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENEMIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total:    ${data.enemyCount}
  Shwarms:  ${data.shwarmCount} (${data.shwarmBlockCount} blocks)
  Shnakes:  ${data.shnakeCount} (${data.shnakeSegmentCount} segments)
  Shombies: ${data.shombieCount}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEMORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  JS Heap Used:  ${data.memory !== undefined ? `${data.memory.toFixed(0)}MB` : 'N/A'}
  JS Heap Total: ${data.memoryTotal !== undefined ? `${data.memoryTotal.toFixed(0)}MB` : 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For troubleshooting, share this report with your AI assistant.
Look for systems with high timing values or issues flagged above.`;

    // Append stall diagnostics separately to avoid IIFE issues
    const extra = diagnostics.getExtraStats();
    text += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STALL DIAGNOSTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  LongTasks:        ${extra.longTaskCountTotal} (${extra.longTaskMsTotal.toFixed(1)}ms total)
  EventLoopLag:     ${extra.eventLoopLagCountTotal} spikes (max ${extra.eventLoopLagMaxMsTotal.toFixed(1)}ms)
  Chunk Load/Unload: ${extra.chunkLoadsTotal}/${extra.chunkUnloadsTotal}
  Chunk Fetch/Build: ${extra.chunkFetchMsTotal.toFixed(1)}ms / ${extra.chunkBuildMsTotal.toFixed(1)}ms
  Flatten/Emit:     ${extra.emitsTotal} emits, ${extra.flattenMsTotal.toFixed(1)}ms (${extra.flattenBlocksTotal} blocks)
  Colliders:        +${extra.colliderAddsTotal} -${extra.colliderRemovesTotal} (${extra.colliderMsTotal.toFixed(1)}ms)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHUNK RENDERING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ChunkRenderers:   ${extra.chunkRenderCount}
  ChunkRebuilds:    ${extra.chunkRebuildCountTotal} (${extra.chunkRebuildMsTotal.toFixed(1)}ms)
  GlobalFlatten:    ${extra.globalFlattenMsTotal.toFixed(1)}ms
  Grouping:         ${extra.groupCacheMissesTotal} misses (${extra.groupMsTotal.toFixed(1)}ms for ${extra.groupBlocksTotal} blocks)
  MeshRebuilds:     ${extra.meshRebuildCountTotal} (${extra.meshRebuildMsTotal.toFixed(1)}ms for ${extra.meshRebuildBlocksTotal} blocks)
  MeshInstances:    ${extra.meshInstanceTotal}
  GPU Texture Mem:  ${extra.gpuTextureMemMB.toFixed(1)}MB`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const issues = getIssues();

  return (
    <div className="fixed top-2 left-2 z-[9999] bg-black/90 text-white font-mono text-[11px] p-3 rounded-lg select-none min-w-[240px] max-w-[280px] border border-white/20 shadow-lg">
      {/* Header */}
      <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/20">
        <div className="flex items-center gap-2">
          <span className="text-cyan-400 font-bold">DF</span>
          <span className={`text-xl font-bold ${fpsColor}`}>{data.fps}</span>
          <span className="text-gray-400 text-[10px]">FPS</span>
        </div>
        <button
          onClick={handleCopy}
          className={`pointer-events-auto text-[10px] px-2 py-1 rounded font-medium transition-colors ${
            copied ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {copied ? '✓ Copied' : 'COPY'}
        </button>
      </div>

      {/* Issues Alert */}
      {issues.length > 0 && (
        <div className="mb-2 p-1.5 bg-red-900/50 border border-red-500/50 rounded text-[10px]">
          <div className="text-red-400 font-bold mb-0.5">⚠ Issues:</div>
          {issues.slice(0, 3).map((issue, i) => (
            <div key={i} className="text-red-300 truncate">{issue}</div>
          ))}
        </div>
      )}

      {/* Session Info */}
      <div className="text-gray-500 text-[10px] mb-1">
        Recording: {data.duration}s ({data.sampleCount} samples)
      </div>

      {/* FPS Stats */}
      <div className="grid grid-cols-3 gap-1 mb-2 text-center">
        <div>
          <div className={`font-bold ${avgFpsColor}`}>{data.avgFps.toFixed(0)}</div>
          <div className="text-gray-500 text-[9px]">AVG</div>
        </div>
        <div>
          <div className="text-gray-300">{data.minFps.toFixed(0)}</div>
          <div className="text-gray-500 text-[9px]">MIN</div>
        </div>
        <div>
          <div className="text-gray-300">{data.maxFps.toFixed(0)}</div>
          <div className="text-gray-500 text-[9px]">MAX</div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-2 gap-2">
        {/* Left Column - Timing */}
        <div>
          <div className="text-cyan-400 text-[10px] font-bold mb-0.5">TIMING</div>
          <div className="space-y-0.5">
            <div className="flex justify-between"><span className="text-gray-400">Ctrl</span><span>{data.controls.toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">AI</span><span className={data.enemyAI > 8 ? 'text-yellow-400' : ''}>{data.enemyAI.toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Blks</span><span>{data.blocks.toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Rndr</span><span className={data.render > 12 ? 'text-yellow-400' : ''}>{data.render.toFixed(1)}</span></div>
          </div>
        </div>

        {/* Right Column - GPU */}
        <div>
          <div className="text-cyan-400 text-[10px] font-bold mb-0.5">GPU</div>
          <div className="space-y-0.5">
            <div className="flex justify-between"><span className="text-gray-400">Draw</span><span>{data.drawCalls}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Tris</span><span>{(data.triangles / 1000).toFixed(0)}K</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Geo</span><span>{data.geometries}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Tex</span><span>{data.textures}</span></div>
          </div>
        </div>
      </div>

      {/* Collision Section */}
      <div className="mt-2 pt-2 border-t border-white/10">
        <div className="text-cyan-400 text-[10px] font-bold mb-0.5">COLLISION</div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <div className={gridColor}>World: {data.worldGrid}</div>
          <div>Entity: {data.entityGrid}</div>
          <div>Cache: {data.gridCacheHitRate.toFixed(0)}%</div>
          <div className="text-gray-500">Max: {data.maxWorldGrid}</div>
        </div>
      </div>

      {/* Chunks Section (Phase 0) */}
      <div className="mt-2 pt-2 border-t border-white/10">
        <div className="text-cyan-400 text-[10px] font-bold mb-0.5">CHUNKS</div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <div className="text-gray-400">Renderers: <span className="text-white">{data.chunkRenderCount}</span></div>
          <div className="text-gray-400">Rebuilds: <span className="text-white">{data.chunkRebuilds}</span></div>
          <div className="text-gray-400">Rebuild: <span className={data.chunkRebuildMs > 100 ? 'text-red-400' : 'text-white'}>{data.chunkRebuildMs.toFixed(0)}ms</span></div>
          <div className="text-gray-400">Flatten: <span className={data.globalFlattenMs > 50 ? 'text-red-400' : data.globalFlattenMs > 10 ? 'text-yellow-400' : 'text-white'}>{data.globalFlattenMs.toFixed(0)}ms</span></div>
          <div className="text-gray-400">Group: <span className={data.groupMs > 100 ? 'text-red-400' : 'text-white'}>{data.groupMisses}x {data.groupMs.toFixed(0)}ms</span></div>
          <div className="text-gray-400">Mesh: <span className={data.meshRebuildMs > 200 ? 'text-red-400' : 'text-white'}>{data.meshRebuilds}x {data.meshRebuildMs.toFixed(0)}ms</span></div>
          <div className="text-gray-400">Instances: <span className="text-white">{(data.meshInstanceTotal / 1000).toFixed(1)}K</span></div>
          <div className="text-gray-400">TexMem: <span className={data.gpuTextureMemMB > 128 ? 'text-yellow-400' : 'text-white'}>{data.gpuTextureMemMB.toFixed(0)}MB</span></div>
        </div>
      </div>

      {/* Enemies Section */}
      <div className="mt-2 pt-2 border-t border-white/10">
        <div className="text-cyan-400 text-[10px] font-bold mb-0.5">ENEMIES ({data.enemyCount})</div>
        <div className="grid grid-cols-3 gap-1 text-[10px] text-center">
          <div>
            <div className="text-orange-400">{data.shwarmCount}</div>
            <div className="text-gray-500 text-[9px]">Shwrm</div>
          </div>
          <div>
            <div className="text-green-400">{data.shnakeCount}</div>
            <div className="text-gray-500 text-[9px]">Shnke</div>
          </div>
          <div>
            <div className="text-purple-400">{data.shombieCount}</div>
            <div className="text-gray-500 text-[9px]">Shmbi</div>
          </div>
        </div>
      </div>

      {/* Memory */}
      {data.memory !== undefined && (
        <div className="mt-2 pt-2 border-t border-white/10 text-[10px]">
          <span className="text-gray-400">Memory: </span>
          <span>{data.memory.toFixed(0)}MB</span>
          {data.memoryTotal !== undefined && (
            <span className="text-gray-500"> / {data.memoryTotal.toFixed(0)}MB</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-2 pt-1 border-t border-white/10 text-gray-500 text-[9px] text-center">
        Shift+3 to close • Click COPY to share diagnostics
      </div>
    </div>
  );
}
