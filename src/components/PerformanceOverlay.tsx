// Real-time Performance Overlay
// Shows live FPS, frame timing breakdown, and system health
// Toggle with Shift+P

import { useEffect, useState, useRef } from 'react';
import { diagnostics } from '@/lib/diagnosticsLogger';

interface PerformanceData {
  fps: number;
  frameTime: number;
  controls: number;
  enemyAI: number;
  blocks: number;
  render: number;
  drawCalls: number;
  triangles: number;
  worldGrid: number;
  entityGrid: number;
  enemyCount: number;
  shwarmCount: number;
  shwarmBlockCount: number;
  shnakeCount: number;
  shnakeSegmentCount: number;
  shombieCount: number;
  memory?: number;
  gridCacheHitRate: number;
}

export function PerformanceOverlay() {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<PerformanceData>({
    fps: 0,
    frameTime: 0,
    controls: 0,
    enemyAI: 0,
    blocks: 0,
    render: 0,
    drawCalls: 0,
    triangles: 0,
    worldGrid: 0,
    entityGrid: 0,
    enemyCount: 0,
    shwarmCount: 0,
    shwarmBlockCount: 0,
    shnakeCount: 0,
    shnakeSegmentCount: 0,
    shombieCount: 0,
    gridCacheHitRate: 0,
  });
  
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const frameTimesRef = useRef<number[]>([]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'P') {
        setVisible(v => !v);
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
        
        setData({
          fps: Math.round(fps),
          frameTime: avgFrameTime,
          controls: d.timeControls,
          enemyAI: d.timeEnemyAI,
          blocks: d.timeBlocks,
          render: d.timeRender,
          drawCalls: d.drawCalls,
          triangles: d.triangles,
          worldGrid: d.worldGridSize,
          entityGrid: d.entityGridSize,
          enemyCount: d.enemyCount,
          shwarmCount: d.shwarmCount,
          shwarmBlockCount: d.shwarmBlockCount,
          shnakeCount: d.shnakeCount,
          shnakeSegmentCount: d.shnakeSegmentCount,
          shombieCount: d.shombieCount,
          memory: d.jsHeapUsed || undefined,
          gridCacheHitRate: hitRate,
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
  const gridColor = data.worldGrid > 5000 ? 'text-red-400' : data.worldGrid > 2000 ? 'text-yellow-400' : 'text-gray-400';
  
  const handleCopy = () => {
    const text = `=== Live Performance Snapshot ===
FPS: ${data.fps} | Frame: ${data.frameTime.toFixed(1)}ms

TIMING (ms/100ms):
  Controls: ${data.controls.toFixed(1)}ms
  EnemyAI: ${data.enemyAI.toFixed(1)}ms
  Blocks: ${data.blocks.toFixed(1)}ms
  Render: ${data.render.toFixed(1)}ms

GPU:
  Draw Calls: ${data.drawCalls}
  Triangles: ${(data.triangles / 1000).toFixed(1)}K

COLLISION:
  World Grid: ${data.worldGrid}
  Entity Grid: ${data.entityGrid}
  Cache Hit: ${data.gridCacheHitRate.toFixed(0)}%

ENEMIES:
  Total: ${data.enemyCount}
  Shwarms: ${data.shwarmCount} (${data.shwarmBlockCount} blocks)
  Shnakes: ${data.shnakeCount} (${data.shnakeSegmentCount} segments)
  Shombies: ${data.shombieCount}
${data.memory !== undefined ? `\nMemory: ${data.memory.toFixed(0)}MB` : ''}`;
    
    navigator.clipboard.writeText(text);
  };
  
  return (
    <div className="fixed top-2 left-2 z-50 bg-black/80 text-white font-mono text-xs p-2 rounded select-none min-w-[180px]">
      <div className="flex justify-between items-center">
        <div className={`text-lg font-bold ${fpsColor}`}>
          {data.fps} FPS
        </div>
        <button 
          onClick={handleCopy}
          className="pointer-events-auto text-[10px] bg-gray-700 hover:bg-gray-600 px-1.5 py-0.5 rounded"
        >
          Copy
        </button>
      </div>
      <div className="text-gray-400">
        Frame: {data.frameTime.toFixed(1)}ms
      </div>
      
      <div className="mt-1 border-t border-gray-600 pt-1">
        <div className="text-gray-500 text-[10px] mb-0.5">TIMING (ms/100ms)</div>
        <div>Controls: {data.controls.toFixed(1)}</div>
        <div>EnemyAI: {data.enemyAI.toFixed(1)}</div>
        <div>Blocks: {data.blocks.toFixed(1)}</div>
        <div>Render: {data.render.toFixed(1)}</div>
      </div>
      
      <div className="mt-1 border-t border-gray-600 pt-1">
        <div className="text-gray-500 text-[10px] mb-0.5">GPU</div>
        <div>Draw Calls: {data.drawCalls}</div>
        <div>Triangles: {(data.triangles / 1000).toFixed(1)}K</div>
      </div>
      
      <div className="mt-1 border-t border-gray-600 pt-1">
        <div className="text-gray-500 text-[10px] mb-0.5">COLLISION</div>
        <div className={gridColor}>World Grid: {data.worldGrid}</div>
        <div>Entity Grid: {data.entityGrid}</div>
        <div>Cache Hit: {data.gridCacheHitRate.toFixed(0)}%</div>
      </div>
      
      <div className="mt-1 border-t border-gray-600 pt-1">
        <div className="text-gray-500 text-[10px] mb-0.5">ENEMIES</div>
        <div>Total: {data.enemyCount}</div>
        <div>Shwarms: {data.shwarmCount} ({data.shwarmBlockCount} blocks)</div>
        <div>Shnakes: {data.shnakeCount} ({data.shnakeSegmentCount} segs)</div>
        <div>Shombies: {data.shombieCount}</div>
      </div>
      
      {data.memory !== undefined && (
        <div className="mt-1 border-t border-gray-600 pt-1 text-gray-400">
          Memory: {data.memory.toFixed(0)}MB
        </div>
      )}
      
      <div className="mt-1 text-gray-500 text-[10px]">
        Shift+P to hide
      </div>
    </div>
  );
}
