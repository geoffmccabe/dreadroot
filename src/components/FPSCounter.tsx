import { useThree } from '@react-three/fiber';
import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { diagnostics } from '@/lib/diagnosticsLogger';

let globalFps = 0;
let globalPlayerPos = { x: 0, y: 0, z: 0 };
let globalViewDir = { x: 0, y: 0, z: 0 };

// Admin block inspect data - set from FortressControls on right-click
export let globalInspectData: {
  gridPos: string;
  meshBlockType: string;
  isTree: boolean;
  hasCollider: boolean;
  isGround: boolean;
  source: string; // Where found: 'mesh', 'ground', 'state', 'chunks', 'indexedDB', 'none'
  inMesh: boolean;
  inState: boolean;
  inChunks: boolean;
  inIndexedDB: boolean;
  dbId: string | null;
  dbBlockType: string | null;
  dbUserId: string | null;
  rawInfo: string; // Full details for copy
  timestamp: number;
} | null = null;

export function setGlobalInspectData(data: typeof globalInspectData) {
  globalInspectData = data;
}

export function clearGlobalInspectData() {
  globalInspectData = null;
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
  const { camera } = useThree();
  const viewDirRef = useRef(new THREE.Vector3());

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

        // Update DOM directly for better performance
        if (isAdmin) {
          const fpsPvElement = document.getElementById('fps-pv-display');
          const vElement = document.getElementById('fps-v-display');
          const dflowText = diagnostics.enabled ? ` DFLOW:${diagnostics.elapsedSeconds}` : '';

          if (fpsPvElement) {
            fpsPvElement.textContent = `FPS: ${globalFps}${dflowText} | P:[${globalPlayerPos.x},${globalPlayerPos.y},${globalPlayerPos.z}] `;
          }
          if (vElement) {
            vElement.textContent = `V:[${globalViewDir.x},${globalViewDir.y},${globalViewDir.z}]`;
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
  }), [camera, isAdmin]);

  return null;
});

FPSCounter.displayName = 'FPSCounter';

interface FPSDisplayProps {
  isAdmin?: boolean;
}

export function FPSDisplay({ isAdmin = false }: FPSDisplayProps) {
  const [inspectData, setInspectData] = useState<typeof globalInspectData>(null);
  const [copied, setCopied] = useState(false);

  // Poll for inspect data changes (admin only)
  useEffect(() => {
    if (!isAdmin) return;

    const interval = setInterval(() => {
      if (globalInspectData && globalInspectData.timestamp !== inspectData?.timestamp) {
        setInspectData(globalInspectData);
        setCopied(false);
      } else if (!globalInspectData && inspectData) {
        setInspectData(null);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isAdmin, inspectData?.timestamp]);

  const handleDismiss = () => {
    clearGlobalInspectData();
    setInspectData(null);
  };

  const handleCopy = async () => {
    if (inspectData?.rawInfo) {
      await navigator.clipboard.writeText(inspectData.rawInfo);
      setCopied(true);
    }
  };

  if (isAdmin) {
    return (
      <div className="fixed top-2 left-2 z-50 text-xs flex flex-col gap-1">
        <div
          id="fps-display"
          className="pointer-events-none"
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
        {inspectData && (
          <div
            style={{
              borderRadius: '6px',
              border: '1px solid hsla(40, 70%, 60%, 0.8)',
              background: 'hsla(40, 30%, 25%, 0.95)',
              color: 'hsl(40, 80%, 90%)',
              fontFamily: 'monospace',
              padding: '6px 8px',
              fontSize: '10px',
              lineHeight: '1.4',
              position: 'relative',
              minWidth: '180px',
            }}
          >
            {/* X close button */}
            <button
              onClick={handleDismiss}
              style={{
                position: 'absolute',
                top: '2px',
                right: '2px',
                background: 'transparent',
                border: 'none',
                color: 'hsl(40, 60%, 70%)',
                cursor: 'pointer',
                fontSize: '14px',
                lineHeight: '1',
                padding: '2px 4px',
              }}
              title="Close"
            >
              ×
            </button>
            <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>BLOCK INSPECT</div>
            <div>Pos: [{inspectData.gridPos}]</div>
            <div>Type: {inspectData.meshBlockType}</div>
            <div>Ground: {inspectData.isGround ? 'YES' : 'NO'} | Tree: {inspectData.isTree ? 'YES' : 'NO'}</div>
            <div>Collider: {inspectData.hasCollider ? 'YES' : 'NO'}</div>
            <div style={{ borderTop: '1px solid hsla(40, 50%, 50%, 0.5)', marginTop: '3px', paddingTop: '3px' }}>
              Sources:
            </div>
            <div style={{ fontSize: '9px' }}>
              Mesh: {inspectData.inMesh ? 'Y' : 'N'} | State: {inspectData.inState ? 'Y' : 'N'} | Chunks: {inspectData.inChunks ? 'Y' : 'N'} | IDB: {inspectData.inIndexedDB ? 'Y' : 'N'}
            </div>
            {inspectData.dbId ? (
              <>
                <div style={{ borderTop: '1px solid hsla(40, 50%, 50%, 0.5)', marginTop: '3px', paddingTop: '3px' }}>DB Record:</div>
                <div>ID: {inspectData.dbId.slice(0, 8)}...</div>
                <div>Type: {inspectData.dbBlockType}</div>
                <div>Owner: {inspectData.dbUserId ? inspectData.dbUserId.slice(0, 8) + '...' : 'unowned'}</div>
              </>
            ) : (
              <div style={{ color: 'hsl(0, 60%, 70%)', marginTop: '3px' }}>NO DB RECORD</div>
            )}
            {/* Copy button icon */}
            <button
              onClick={handleCopy}
              style={{
                position: 'absolute',
                bottom: '4px',
                right: '4px',
                background: copied ? 'hsl(120, 40%, 35%)' : 'hsl(40, 30%, 35%)',
                border: '1px solid hsla(40, 50%, 50%, 0.5)',
                borderRadius: '3px',
                color: 'hsl(40, 80%, 90%)',
                cursor: 'pointer',
                fontSize: '10px',
                padding: '2px 5px',
              }}
              title="Copy to clipboard"
            >
              {copied ? '✓' : '⧉'}
            </button>
          </div>
        )}
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
