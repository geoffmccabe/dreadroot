import { useThree } from '@react-three/fiber';
import { useRef, useState, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { diagnostics } from '@/lib/diagnosticsLogger';

let globalFps = 0;
let globalPlayerPos = { x: 0, y: 0, z: 0 };
let globalViewDir = { x: 0, y: 0, z: 0 };

// Admin block inspect data - set from FortressControls on right-click
export interface InspectSourceMesh {
  found: boolean;
  instanceId?: number;
  meshName?: string;
  blockType?: string;
}

export interface InspectSourceState {
  found: boolean;
  blockId?: string;
  blockType?: string;
  userId?: string;
  createdAt?: string;
  expiresAt?: string;
}

export interface InspectSourceChunks {
  found: boolean;
  chunkKey?: string;
  fromVisibleBlocks?: boolean;
  blockCount?: number;
}

export interface InspectSourceIndexedDB {
  found: boolean;
  loading: boolean;
  chunkKey?: string;
  blockType?: string;
  cachedAt?: number;
}

export interface InspectSourceCollider {
  found: boolean;
  bounds?: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
}

export interface InspectSourceTree {
  found: boolean;
  baseType?: string;
  depth?: number;
  tier?: number;
}

export interface InspectSources {
  mesh: InspectSourceMesh;
  state: InspectSourceState;
  chunks: InspectSourceChunks;
  indexedDB: InspectSourceIndexedDB;
  collider: InspectSourceCollider;
  tree: InspectSourceTree;
}

export interface GlobalInspectData {
  gridPos: { x: number; y: number; z: number };
  losDistance: number;
  isGround: boolean;
  sources: InspectSources;
  isOrphaned: boolean;
  orphanDetails: string[];
  rawInfo: string;
  timestamp: number;
}

export let globalInspectData: GlobalInspectData | null = null;

export function setGlobalInspectData(data: GlobalInspectData | null) {
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

// Delete handler type for Block Inspector
export type BlockDeleteHandler = (blockId: string, blockType: string, ownerId: string) => Promise<boolean>;

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
  userRoles?: string[];
  onDeleteBlock?: BlockDeleteHandler;
}

export function FPSDisplay({ isAdmin = false, userRoles = [], onDeleteBlock }: FPSDisplayProps) {
  const [inspectData, setInspectData] = useState<GlobalInspectData | null>(null);
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Check if user can delete (admin or superadmin)
  const canDelete = userRoles.includes('admin') || userRoles.includes('superadmin');

  // Poll for inspect data changes (admin only)
  useEffect(() => {
    if (!isAdmin) return;

    const interval = setInterval(() => {
      if (globalInspectData && globalInspectData.timestamp !== inspectData?.timestamp) {
        setInspectData(globalInspectData);
        setCopied(false);
        setShowDeleteConfirm(false); // Reset delete confirmation when new block selected
      } else if (!globalInspectData && inspectData) {
        setInspectData(null);
        setShowDeleteConfirm(false); // Reset when inspector closed
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isAdmin, inspectData?.timestamp]);

  // Keyboard handler for DELETE key when confirmation is showing
  useEffect(() => {
    if (!showDeleteConfirm || isDeleting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowDeleteConfirm(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDeleteConfirm, isDeleting, handleDeleteConfirm]);

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

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const handleDeleteConfirm = useCallback(async () => {
    if (!inspectData?.sources.state.blockId || !onDeleteBlock) return;

    setIsDeleting(true);
    try {
      const success = await onDeleteBlock(
        inspectData.sources.state.blockId,
        inspectData.sources.state.blockType || 'unknown',
        inspectData.sources.state.userId || ''
      );
      if (success) {
        setShowDeleteConfirm(false);
        clearGlobalInspectData();
        setInspectData(null);
      }
    } finally {
      setIsDeleting(false);
    }
  }, [inspectData, onDeleteBlock]);

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
              background: 'hsla(40, 30%, 20%, 0.98)',
              color: 'hsl(40, 80%, 90%)',
              fontFamily: 'monospace',
              padding: '8px 10px',
              fontSize: '11px',
              lineHeight: '1.5',
              position: 'relative',
              minWidth: '280px',
              maxWidth: '320px',
              maxHeight: '500px',
              overflowY: 'auto',
            }}
          >
            {/* Header with close button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', borderBottom: '1px solid hsla(40, 50%, 50%, 0.5)', paddingBottom: '4px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '12px' }}>BLOCK INSPECTOR</span>
              <button
                onClick={handleDismiss}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'hsl(40, 60%, 70%)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  lineHeight: '1',
                  padding: '0 4px',
                }}
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Position & Basic Info */}
            <div style={{ marginBottom: '6px' }}>
              <div>Position: <span style={{ color: 'hsl(200, 80%, 70%)' }}>[{inspectData.gridPos.x}, {inspectData.gridPos.y}, {inspectData.gridPos.z}]</span></div>
              <div>LoS Distance: <span style={{ color: 'hsl(200, 80%, 70%)' }}>{inspectData.losDistance.toFixed(1)} blocks</span></div>
              {inspectData.isGround && <div style={{ color: 'hsl(120, 60%, 60%)' }}>Ground Block</div>}
            </div>

            {/* Sources Section */}
            <div style={{ borderTop: '1px solid hsla(40, 50%, 50%, 0.5)', paddingTop: '4px', marginBottom: '6px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>DATA SOURCES</div>

              {/* Mesh */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: inspectData.sources.mesh.found ? 'hsl(120, 70%, 55%)' : 'hsl(0, 70%, 55%)', fontWeight: 'bold' }}>
                  {inspectData.sources.mesh.found ? '✓' : '✗'}
                </span>
                <span>Mesh:</span>
                <span style={{ color: 'hsl(200, 70%, 70%)', fontSize: '10px' }}>
                  {inspectData.sources.mesh.found
                    ? `${inspectData.sources.mesh.blockType || 'unknown'} (inst#${inspectData.sources.mesh.instanceId})`
                    : 'Not found'}
                </span>
              </div>

              {/* State Array */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: inspectData.sources.state.found ? 'hsl(120, 70%, 55%)' : 'hsl(0, 70%, 55%)', fontWeight: 'bold' }}>
                  {inspectData.sources.state.found ? '✓' : '✗'}
                </span>
                <span>State:</span>
                <span style={{ color: 'hsl(200, 70%, 70%)', fontSize: '10px' }}>
                  {inspectData.sources.state.found
                    ? `${inspectData.sources.state.blockType} (${inspectData.sources.state.blockId?.slice(0, 8)}...)`
                    : 'Not found'}
                </span>
              </div>

              {/* Loaded Chunks */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: inspectData.sources.chunks.found ? 'hsl(120, 70%, 55%)' : 'hsl(0, 70%, 55%)', fontWeight: 'bold' }}>
                  {inspectData.sources.chunks.found ? '✓' : '✗'}
                </span>
                <span>Chunks:</span>
                <span style={{ color: 'hsl(200, 70%, 70%)', fontSize: '10px' }}>
                  {inspectData.sources.chunks.found
                    ? `${inspectData.sources.chunks.chunkKey}${inspectData.sources.chunks.fromVisibleBlocks ? ' (visible)' : ''}`
                    : 'Not loaded'}
                </span>
              </div>

              {/* IndexedDB */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  color: inspectData.sources.indexedDB.loading
                    ? 'hsl(45, 80%, 55%)'
                    : (inspectData.sources.indexedDB.found ? 'hsl(120, 70%, 55%)' : 'hsl(0, 70%, 55%)'),
                  fontWeight: 'bold'
                }}>
                  {inspectData.sources.indexedDB.loading ? '?' : (inspectData.sources.indexedDB.found ? '✓' : '✗')}
                </span>
                <span>IndexedDB:</span>
                <span style={{ color: 'hsl(200, 70%, 70%)', fontSize: '10px' }}>
                  {inspectData.sources.indexedDB.loading
                    ? 'Loading...'
                    : (inspectData.sources.indexedDB.found
                        ? `${inspectData.sources.indexedDB.blockType} in ${inspectData.sources.indexedDB.chunkKey}`
                        : 'Not cached')}
                </span>
              </div>

              {/* Collider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: inspectData.sources.collider.found ? 'hsl(120, 70%, 55%)' : 'hsl(0, 70%, 55%)', fontWeight: 'bold' }}>
                  {inspectData.sources.collider.found ? '✓' : '✗'}
                </span>
                <span>Collider:</span>
                <span style={{ color: 'hsl(200, 70%, 70%)', fontSize: '10px' }}>
                  {inspectData.sources.collider.found
                    ? `Yes`
                    : 'None'}
                </span>
              </div>

              {/* Tree */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: inspectData.sources.tree.found ? 'hsl(120, 70%, 55%)' : 'hsl(40, 30%, 50%)', fontWeight: 'bold' }}>
                  {inspectData.sources.tree.found ? '✓' : '-'}
                </span>
                <span>Tree:</span>
                <span style={{ color: 'hsl(200, 70%, 70%)', fontSize: '10px' }}>
                  {inspectData.sources.tree.found
                    ? `${inspectData.sources.tree.baseType} (d:${inspectData.sources.tree.depth}, t:${inspectData.sources.tree.tier})`
                    : 'Not a tree block'}
                </span>
              </div>
            </div>

            {/* Orphan Check Section */}
            <div style={{ borderTop: '1px solid hsla(40, 50%, 50%, 0.5)', paddingTop: '4px', marginBottom: '6px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>CONSISTENCY CHECK</div>
              {inspectData.isOrphaned ? (
                <div>
                  <div style={{ color: 'hsl(0, 70%, 60%)', fontWeight: 'bold' }}>⚠ ORPHANED BLOCK</div>
                  {inspectData.orphanDetails.map((detail, i) => (
                    <div key={i} style={{ fontSize: '10px', color: 'hsl(0, 60%, 70%)', paddingLeft: '10px' }}>• {detail}</div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'hsl(120, 60%, 55%)' }}>✓ All sources consistent</div>
              )}
            </div>

            {/* Block Details Section */}
            {inspectData.sources.state.found && (
              <div style={{ borderTop: '1px solid hsla(40, 50%, 50%, 0.5)', paddingTop: '4px', marginBottom: '6px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>BLOCK DETAILS</div>
                <div style={{ fontSize: '10px' }}>
                  <div>ID: {inspectData.sources.state.blockId}</div>
                  <div>Type: {inspectData.sources.state.blockType}</div>
                  <div>Owner: {inspectData.sources.state.userId || 'unowned'}</div>
                  {inspectData.sources.state.createdAt && <div>Created: {new Date(inspectData.sources.state.createdAt).toLocaleDateString()}</div>}
                  {inspectData.sources.state.expiresAt && <div>Expires: {inspectData.sources.state.expiresAt}</div>}
                </div>
              </div>
            )}

            {/* Delete confirmation dialog */}
            {showDeleteConfirm && (
              <div style={{
                borderTop: '1px solid hsla(0, 50%, 50%, 0.8)',
                paddingTop: '8px',
                marginTop: '4px',
                marginBottom: '4px',
              }}>
                <div style={{ color: 'hsl(0, 70%, 70%)', fontWeight: 'bold', marginBottom: '6px' }}>
                  Delete this block?
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={isDeleting}
                    style={{
                      background: isDeleting ? 'hsl(0, 30%, 30%)' : 'hsl(0, 50%, 40%)',
                      border: '1px solid hsla(0, 50%, 50%, 0.8)',
                      borderRadius: '4px',
                      color: 'hsl(0, 80%, 95%)',
                      cursor: isDeleting ? 'not-allowed' : 'pointer',
                      fontSize: '10px',
                      padding: '4px 12px',
                      fontWeight: 'bold',
                    }}
                  >
                    {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                  <button
                    onClick={handleDeleteCancel}
                    disabled={isDeleting}
                    style={{
                      background: 'hsl(40, 30%, 35%)',
                      border: '1px solid hsla(40, 50%, 50%, 0.5)',
                      borderRadius: '4px',
                      color: 'hsl(40, 80%, 90%)',
                      cursor: isDeleting ? 'not-allowed' : 'pointer',
                      fontSize: '10px',
                      padding: '4px 12px',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
              {/* Delete button (admin/superadmin only) */}
              {canDelete && inspectData.sources.state.found && onDeleteBlock && !showDeleteConfirm && (
                <button
                  onClick={handleDeleteClick}
                  style={{
                    background: 'hsl(0, 50%, 35%)',
                    border: '1px solid hsla(0, 50%, 50%, 0.8)',
                    borderRadius: '4px',
                    color: 'hsl(0, 80%, 95%)',
                    cursor: 'pointer',
                    fontSize: '10px',
                    padding: '4px 10px',
                  }}
                  title="Delete this block (admin only)"
                >
                  Delete
                </button>
              )}
              {/* Spacer when delete button not shown */}
              {(!canDelete || !inspectData.sources.state.found || !onDeleteBlock || showDeleteConfirm) && (
                <div />
              )}
              {/* Copy button */}
              <button
                onClick={handleCopy}
                style={{
                  background: copied ? 'hsl(120, 40%, 35%)' : 'hsl(40, 30%, 35%)',
                  border: '1px solid hsla(40, 50%, 50%, 0.5)',
                  borderRadius: '4px',
                  color: 'hsl(40, 80%, 90%)',
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '4px 10px',
                }}
                title="Copy full details to clipboard"
              >
                {copied ? '✓ Copied' : 'Copy Details'}
              </button>
            </div>
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
