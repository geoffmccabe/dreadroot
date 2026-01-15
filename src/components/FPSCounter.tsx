import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { diagnostics } from '@/lib/diagnosticsLogger';

let globalFps = 0;
let globalPlayerPos = { x: 0, y: 0, z: 0 };
let globalViewDir = { x: 0, y: 0, z: 0 };

interface FPSCounterProps {
  isAdmin?: boolean;
}

export function FPSCounter({ isAdmin = false }: FPSCounterProps) {
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const { camera } = useThree();
  const viewDirRef = useRef(new THREE.Vector3());

  useFrame(() => {
    diagnostics.useFrameCallCount++;
    
    frameCountRef.current++;
    const currentTime = performance.now();
    const elapsed = currentTime - lastTimeRef.current;

    // Update FPS every 500ms
    if (elapsed >= 500) {
      globalFps = Math.round((frameCountRef.current / elapsed) * 1000);
      frameCountRef.current = 0;
      lastTimeRef.current = currentTime;
      
      // Update player position
      globalPlayerPos = {
        x: Math.round(camera.position.x),
        y: Math.round(camera.position.y),
        z: Math.round(camera.position.z)
      };
      
      // Update view direction (where camera is looking)
      camera.getWorldDirection(viewDirRef.current);
      globalViewDir = {
        x: Math.round(viewDirRef.current.x * 10) / 10,
        y: Math.round(viewDirRef.current.y * 10) / 10,
        z: Math.round(viewDirRef.current.z * 10) / 10
      };
      
      // Update DOM directly for better performance
      const fpsElement = document.getElementById('fps-display');
      if (fpsElement) {
        const dflowText = diagnostics.enabled ? ` DFLOW:${diagnostics.elapsedSeconds}` : '';
        if (isAdmin) {
          fpsElement.textContent = `FPS: ${globalFps}${dflowText} | P:[${globalPlayerPos.x},${globalPlayerPos.y},${globalPlayerPos.z}] V:[${globalViewDir.x},${globalViewDir.y},${globalViewDir.z}]`;
        } else {
          fpsElement.textContent = `FPS: ${globalFps}${dflowText}`;
        }
      }
    }
  });

  return null;
}

interface FPSDisplayProps {
  isAdmin?: boolean;
}

export function FPSDisplay({ isAdmin = false }: FPSDisplayProps) {
  return (
    <div 
      id="fps-display" 
      className="fixed top-2 left-2 z-50 text-white text-xs font-mono bg-black/70 px-2 py-1 rounded pointer-events-none"
    >
      {isAdmin ? 'FPS: -- | P:[0,0,0] V:[0,0,0]' : 'FPS: --'}
    </div>
  );
}
