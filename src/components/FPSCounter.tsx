import { useThree } from '@react-three/fiber';
import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { diagnostics } from '@/lib/diagnosticsLogger';

let globalFps = 0;
let globalPlayerPos = { x: 0, y: 0, z: 0 };
let globalViewDir = { x: 0, y: 0, z: 0 };

// Pointer beam state — shared between FPSCounter (Canvas) and FPSDisplay (HTML)
let globalPointerBeamActive = false;
let globalTargetCoords: { x: number; y: number; z: number } | null = null;

export function togglePointerBeam() {
  globalPointerBeamActive = !globalPointerBeamActive;
  // Update the V: span highlight immediately
  const vSpan = document.getElementById('fps-v-display');
  if (vSpan) {
    vSpan.style.color = globalPointerBeamActive ? '#00ffff' : '';
  }
}

export interface FPSCounterHandle {
  update: () => void;
}

interface FPSCounterProps {
  isAdmin?: boolean;
}

export const FPSCounter = forwardRef<FPSCounterHandle, FPSCounterProps>(({ isAdmin = false }, ref) => {
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const { camera, scene } = useThree();
  const viewDirRef = useRef(new THREE.Vector3());

  // Pointer beam raycaster — pre-allocated, reused
  const raycasterRef = useRef(new THREE.Raycaster());
  const rayDirRef = useRef(new THREE.Vector3());

  // Beam line mesh — persistent, added to scene
  const beamLineRef = useRef<THREE.Line | null>(null);
  const beamGeoRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(6); // 2 points x 3 components
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    beamLineRef.current = line;
    beamGeoRef.current = geo;

    return () => {
      scene.remove(line);
      geo.dispose();
      mat.dispose();
    };
  }, [scene]);

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

        // Update view direction (where camera is looking)
        camera.getWorldDirection(viewDirRef.current);
        globalViewDir = {
          x: Math.round(viewDirRef.current.x * 10) / 10,
          y: Math.round(viewDirRef.current.y * 10) / 10,
          z: Math.round(viewDirRef.current.z * 10) / 10
        };

        // Pointer beam raycasting
        if (globalPointerBeamActive) {
          rayDirRef.current.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
          raycasterRef.current.set(camera.position, rayDirRef.current);
          raycasterRef.current.far = 1000;

          const intersections = raycasterRef.current.intersectObjects(scene.children, true);
          // Filter out the beam line itself
          const hit = intersections.find(i => i.object !== beamLineRef.current);

          if (hit) {
            globalTargetCoords = {
              x: Math.round(hit.point.x),
              y: Math.round(hit.point.y),
              z: Math.round(hit.point.z)
            };
          } else {
            globalTargetCoords = null;
          }

          // Update beam line geometry
          if (beamGeoRef.current) {
            const posArr = beamGeoRef.current.attributes.position.array as Float32Array;
            posArr[0] = camera.position.x;
            posArr[1] = camera.position.y;
            posArr[2] = camera.position.z;
            if (hit) {
              posArr[3] = hit.point.x;
              posArr[4] = hit.point.y;
              posArr[5] = hit.point.z;
            } else {
              // Extend far into the distance
              posArr[3] = camera.position.x + rayDirRef.current.x * 500;
              posArr[4] = camera.position.y + rayDirRef.current.y * 500;
              posArr[5] = camera.position.z + rayDirRef.current.z * 500;
            }
            beamGeoRef.current.attributes.position.needsUpdate = true;
          }
          if (beamLineRef.current) beamLineRef.current.visible = true;
        } else {
          if (beamLineRef.current) beamLineRef.current.visible = false;
          globalTargetCoords = null;
        }

        // Update DOM directly for better performance
        if (isAdmin) {
          const fpsPvElement = document.getElementById('fps-pv-display');
          const vElement = document.getElementById('fps-v-display');
          const dflowText = diagnostics.enabled ? ` DFLOW:${diagnostics.elapsedSeconds}` : '';

          if (fpsPvElement) {
            fpsPvElement.textContent = `FPS: ${globalFps}${dflowText} | P:[${globalPlayerPos.x},${globalPlayerPos.y},${globalPlayerPos.z}] `;
          }
          if (vElement) {
            if (globalPointerBeamActive) {
              vElement.textContent = globalTargetCoords
                ? `V→[${globalTargetCoords.x},${globalTargetCoords.y},${globalTargetCoords.z}]`
                : 'V→∞';
            } else {
              vElement.textContent = `V:[${globalViewDir.x},${globalViewDir.y},${globalViewDir.z}]`;
            }
          }
        } else {
          const fpsElement = document.getElementById('fps-display');
          if (fpsElement) {
            const dflowText = diagnostics.enabled ? ` DFLOW:${diagnostics.elapsedSeconds}` : '';
            fpsElement.textContent = `FPS: ${globalFps}${dflowText}`;
          }
        }
      }
    }
  }), [camera, scene, isAdmin]);

  return null;
});

FPSCounter.displayName = 'FPSCounter';

interface FPSDisplayProps {
  isAdmin?: boolean;
}

export function FPSDisplay({ isAdmin = false }: FPSDisplayProps) {
  // Listen for B key to toggle pointer beam (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'l' || e.key === 'L') {
        togglePointerBeam();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAdmin]);

  if (isAdmin) {
    return (
      <div
        id="fps-display"
        className="fixed top-2 left-2 z-50 text-xs pointer-events-none"
        style={{
          borderRadius: '6px',
          border: '1px solid hsla(211, 34%, 73%, 0.8)',
          background: 'hsla(211, 30%, 51%, 0.35)',
          color: 'hsl(211, 32%, 90%)',
          fontFamily: 'Inter, sans-serif',
          padding: '4px 8px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span id="fps-pv-display">
          FPS: -- | P:[0,0,0]{' '}
        </span>
        <span id="fps-v-display">
          V:[0,0,0]
        </span>
      </div>
    );
  }

  return (
    <div
      id="fps-display"
      className="fixed top-2 left-2 z-50 text-xs pointer-events-none"
      style={{
        borderRadius: '6px',
        border: '1px solid hsla(211, 34%, 73%, 0.8)',
        background: 'hsla(211, 30%, 51%, 0.35)',
        color: 'hsl(211, 32%, 90%)',
        fontFamily: 'Inter, sans-serif',
        padding: '4px 8px',
      }}
    >
      FPS: --
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
