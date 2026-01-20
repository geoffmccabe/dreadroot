import { useThree } from '@react-three/fiber';
import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { useBlocks } from '@/contexts/BlocksContext';
import { voxelRaycast } from '@/lib/voxelRaycast';

let globalFps = 0;
let globalPlayerPos = { x: 0, y: 0, z: 0 };
let globalLookAt = { x: '∞', y: '∞', z: '∞' };

export interface FPSCounterHandle {
  update: () => void;
}

interface FPSCounterProps {
  isAdmin?: boolean;
}

export const FPSCounter = forwardRef<FPSCounterHandle, FPSCounterProps>(({ isAdmin = false }, ref) => {
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const { camera } = useThree();
  const viewDirRef = useRef(new THREE.Vector3());
  const { blocks } = useBlocks();
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Expose update function instead of using useFrame
  useImperativeHandle(ref, () => ({
    update: () => {
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
        
        // Raycast to find what we're looking at
        camera.getWorldDirection(viewDirRef.current);
        const hit = voxelRaycast(
          camera.position,
          viewDirRef.current,
          100, // max distance
          blocksRef.current
        );
        
        if (hit) {
          // Show the grid position of the hit voxel
          globalLookAt = {
            x: String(hit.voxelX),
            y: String(hit.voxelY),
            z: String(hit.voxelZ)
          };
        } else {
          // Looking at sky/nothing
          globalLookAt = { x: '∞', y: '∞', z: '∞' };
        }
        
        // Update DOM directly for better performance
        const fpsElement = document.getElementById('fps-display');
        if (fpsElement) {
          const dflowText = diagnostics.enabled ? ` DFLOW:${diagnostics.elapsedSeconds}` : '';
          if (isAdmin) {
            fpsElement.textContent = `FPS: ${globalFps}${dflowText} | P:[${globalPlayerPos.x},${globalPlayerPos.y},${globalPlayerPos.z}] V:[${globalLookAt.x},${globalLookAt.y},${globalLookAt.z}]`;
          } else {
            fpsElement.textContent = `FPS: ${globalFps}${dflowText}`;
          }
        }
      }
    }
  }), [camera, isAdmin]);

  return null;
});

FPSCounter.displayName = 'FPSCounter';

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

export function DFlowOutputPanel() {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  
  useEffect(() => {
    const checkOutput = () => {
      if (diagnostics.showOutput && diagnostics.lastOutput) {
        setSampleCount(diagnostics.lastOutput.split('\n').length - 1);
        setVisible(true);
        setCopied(false);
      }
    };
    
    const interval = setInterval(checkOutput, 200);
    return () => clearInterval(interval);
  }, []);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(diagnostics.lastOutput);
    setCopied(true);
  };
  
  const handleDismiss = () => {
    diagnostics.dismissOutput();
    setVisible(false);
  };
  
  if (!visible) return null;
  
  return (
    <div className="fixed top-16 left-2 z-[9999] bg-black/90 border border-white/30 rounded-lg p-3">
      <div className="text-white font-mono text-sm mb-2">
        D-Flow: {sampleCount} samples
      </div>
      <div className="flex gap-2">
        <button 
          onClick={handleCopy}
          className={`px-3 py-1 rounded text-sm font-medium ${
            copied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          {copied ? '✓ Copied' : 'Copy Data'}
        </button>
        <button 
          onClick={handleDismiss}
          className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-500"
        >
          Close
        </button>
      </div>
    </div>
  );
}
