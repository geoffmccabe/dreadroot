import { useFrame } from '@react-three/fiber';
import { useRef, useEffect } from 'react';

let globalFps = 0;

export function FPSCounter() {
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useFrame(() => {
    frameCountRef.current++;
    const currentTime = performance.now();
    const elapsed = currentTime - lastTimeRef.current;

    // Update FPS every 500ms
    if (elapsed >= 500) {
      globalFps = Math.round((frameCountRef.current / elapsed) * 1000);
      frameCountRef.current = 0;
      lastTimeRef.current = currentTime;
      
      // Update DOM directly for better performance
      const fpsElement = document.getElementById('fps-display');
      if (fpsElement) {
        fpsElement.textContent = `FPS: ${globalFps}`;
      }
    }
  });

  return null;
}

export function FPSDisplay() {
  return (
    <div 
      id="fps-display" 
      className="fixed top-2 left-2 z-50 text-white text-xs font-mono bg-black/70 px-2 py-1 rounded pointer-events-none"
    >
      FPS: --
    </div>
  );
}
