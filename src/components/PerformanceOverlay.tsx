// Real-time Performance Overlay
// Shows live FPS and frame timing breakdown
// Toggle with Shift+P

import { useEffect, useState, useRef } from 'react';

interface PerformanceData {
  fps: number;
  frameTime: number;
  controls: number;
  coins: number;
  waterfall: number;
  blocks: number;
  memory?: number;
}

export function PerformanceOverlay() {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<PerformanceData>({
    fps: 0,
    frameTime: 0,
    controls: 0,
    coins: 0,
    waterfall: 0,
    blocks: 0,
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
        
        // Get diagnostics data if available
        const d = (window as any).__d;
        
        setData({
          fps: Math.round(fps),
          frameTime: avgFrameTime,
          controls: d?.timeControls || 0,
          coins: d?.timeCoins || 0,
          waterfall: d?.timeWaterfall || 0,
          blocks: d?.timeBlocks || 0,
          memory: (performance as any).memory?.usedJSHeapSize / 1048576,
        });
        
        // Reset counters
        frameCountRef.current = 0;
        lastTimeRef.current = now;
        
        // Reset diagnostics accumulators
        if (d) {
          d.timeControls = 0;
          d.timeCoins = 0;
          d.timeWaterfall = 0;
          d.timeBlocks = 0;
        }
      }
      
      animationId = requestAnimationFrame(measure);
    };
    
    animationId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(animationId);
  }, [visible]);
  
  if (!visible) return null;
  
  const fpsColor = data.fps >= 55 ? 'text-green-400' : data.fps >= 30 ? 'text-yellow-400' : 'text-red-400';
  
  return (
    <div className="fixed top-2 left-2 z-50 bg-black/80 text-white font-mono text-xs p-2 rounded pointer-events-none select-none">
      <div className={`text-lg font-bold ${fpsColor}`}>
        {data.fps} FPS
      </div>
      <div className="text-gray-400">
        Frame: {data.frameTime.toFixed(1)}ms
      </div>
      <div className="mt-1 border-t border-gray-600 pt-1">
        <div>Controls: {data.controls.toFixed(1)}ms</div>
        <div>Coins: {data.coins.toFixed(1)}ms</div>
        <div>Waterfall: {data.waterfall.toFixed(1)}ms</div>
        <div>Blocks: {data.blocks.toFixed(1)}ms</div>
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
