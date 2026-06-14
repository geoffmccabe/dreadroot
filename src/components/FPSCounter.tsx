import { useThree } from '@react-three/fiber';
import { useRef, useState, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { supabase } from '@/integrations/supabase/client';
import { APP_VERSION } from '@/version';
import { useDebugStatus } from '@/lib/debugStatus';

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

// Inspector Mode state - toggled with Ctrl+I
export let inspectorModeEnabled = false;

export function setGlobalInspectData(data: GlobalInspectData | null) {
  globalInspectData = data;
}

export function clearGlobalInspectData() {
  globalInspectData = null;
}

export function setInspectorMode(enabled: boolean) {
  inspectorModeEnabled = enabled;
  if (!enabled) {
    globalInspectData = null;
  }
}

export function toggleInspectorMode() {
  setInspectorMode(!inspectorModeEnabled);
  return inspectorModeEnabled;
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
  const { camera } = useThree();

  // The consolidated game frame-loop still calls .update() — keep it a harmless no-op. FPS is now
  // measured by a dedicated requestAnimationFrame loop below that counts REAL browser frames. The
  // previous useFrame-driven count read far too low (showed ~7 at 60fps).
  useImperativeHandle(ref, () => ({ update: () => {} }), []);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let windowStart = performance.now();
    let lastFrame = windowStart;
    let instant = 0;
    const viewDir = new THREE.Vector3();

    const tick = () => {
      const now = performance.now();
      const ft = now - lastFrame;
      lastFrame = now;
      // Smoothed instantaneous FPS (1 / frame time) to capture peaks between window updates.
      if (ft > 0) instant = Math.round(instant * 0.7 + (1000 / ft) * 0.3);
      frames++;

      // Refresh the readout every 500ms: average FPS over the window = frames / elapsed.
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        const avg = Math.round((frames / elapsed) * 1000);
        const displayFps = Math.max(avg, instant);
        globalFps = avg;
        frames = 0;
        windowStart = now;

        const px = Math.round(camera.position.x);
        const py = Math.round(camera.position.y);
        const pz = Math.round(camera.position.z);
        globalPlayerPos = { x: px, y: py, z: pz };
        camera.getWorldDirection(viewDir);
        const vx = Math.round(viewDir.x * 10) / 10;
        const vy = Math.round(viewDir.y * 10) / 10;
        const vz = Math.round(viewDir.z * 10) / 10;
        globalViewDir = { x: vx, y: vy, z: vz };

        // Headroom: display FPS is vsync-capped at the monitor's refresh, so show the game-loop's
        // main-thread CPU cost per frame instead — that IS uncapped. Low ms = lots of CPU room.
        // (A single "uncapped FPS" number is misleading because it ignores GPU + stalls; the DFlow
        // report breaks those out.)
        const workMs = diagnostics.lastFrameWorkMs;
        const capText = workMs > 0 ? ` · CPU ${workMs.toFixed(1)}ms` : '';
        const dflowText = diagnostics.enabled ? ` DFLOW:${diagnostics.elapsedSeconds}` : '';
        if (isAdmin) {
          const fpsPvElement = document.getElementById('fps-pv-display');
          const vElement = document.getElementById('fps-v-display');
          if (fpsPvElement) fpsPvElement.textContent = `FPS: ${displayFps}${capText}${dflowText} | P:[${px},${py},${pz}] `;
          if (vElement) vElement.textContent = `V:[${vx},${vy},${vz}]`;
        } else {
          const fpsElement = document.getElementById('fps-display');
          if (fpsElement) fpsElement.textContent = `FPS: ${displayFps}${capText}${dflowText}`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isAdmin, camera]);

  return null;
});

FPSCounter.displayName = 'FPSCounter';

// Wraps the WebGL renderer to time the render itself — the game-loop timer ends BEFORE r3f's
// gl.render runs, so render cost was previously unmeasured. The real render ALWAYS executes; all
// timing is best-effort inside try/catch so it can never break rendering. Where supported, also
// reads a true GPU timer query (EXT_disjoint_timer_query_webgl2).
export function RenderTimer() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const renderer: any = gl;
    const orig = renderer?.render?.bind(renderer);
    if (!orig) return;
    let ctx: any = null;
    try { ctx = renderer.getContext?.(); } catch { ctx = null; }
    let ext: any = null;
    try { ext = ctx?.getExtension?.('EXT_disjoint_timer_query_webgl2') || null; } catch { ext = null; }
    let pending: any = null;
    renderer.render = function (scene: any, camera: any) {
      let started = false;
      try {
        if (ext && ctx && !pending) {
          const q = ctx.createQuery();
          if (q) { ctx.beginQuery(ext.TIME_ELAPSED_EXT, q); pending = q; started = true; }
        }
      } catch { started = false; }
      const t0 = performance.now();
      orig(scene, camera); // the real render — ALWAYS runs, outside any try
      diagnostics.recordRenderSubmit(performance.now() - t0);
      try { if (started && ext && ctx) ctx.endQuery(ext.TIME_ELAPSED_EXT); } catch {}
      try {
        if (pending && !started && ext && ctx) {
          const avail = ctx.getQueryParameter(pending, ctx.QUERY_RESULT_AVAILABLE);
          const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT);
          if (avail) {
            if (!disjoint) { const ns = ctx.getQueryParameter(pending, ctx.QUERY_RESULT); diagnostics.recordGpuMs(ns / 1e6); }
            ctx.deleteQuery(pending); pending = null;
          }
        }
      } catch { /* ignore — render already ran */ }
    };
    return () => { try { renderer.render = orig; } catch { /* noop */ } };
  }, [gl]);
  return null;
}

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
  const [isInspectorMode, setIsInspectorMode] = useState(false);
  const [isLookingAtSky, setIsLookingAtSky] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const lastOwnerId = useRef<string | null>(null);

  // Check if user can delete (admin or superadmin)
  const canDelete = userRoles.includes('admin') || userRoles.includes('superadmin');

  // Fetch owner name when owner changes
  useEffect(() => {
    const ownerId = inspectData?.sources.state.userId;
    if (!ownerId || ownerId === lastOwnerId.current) return;

    lastOwnerId.current = ownerId;
    setOwnerName(null); // Reset while loading

    supabase
      .from('user_profiles')
      .select('display_name')
      .eq('id', ownerId)
      .single()
      .then(({ data }) => {
        if (data?.display_name) {
          setOwnerName(data.display_name);
        }
      });
  }, [inspectData?.sources.state.userId]);

  // Handler functions defined first so useEffects can reference them
  const handleDismiss = useCallback(() => {
    setInspectorMode(false);
    clearGlobalInspectData();
    setInspectData(null);
    setIsInspectorMode(false);
    setIsLookingAtSky(false);
  }, []);

  const handleCopy = useCallback(async () => {
    if (inspectData?.rawInfo) {
      await navigator.clipboard.writeText(inspectData.rawInfo);
      setCopied(true);
    }
  }, [inspectData?.rawInfo]);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

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

  // Poll for inspect data changes and inspector mode state (admin only)
  useEffect(() => {
    if (!isAdmin) return;

    const interval = setInterval(() => {
      // Track inspector mode state
      if (inspectorModeEnabled !== isInspectorMode) {
        setIsInspectorMode(inspectorModeEnabled);
        if (!inspectorModeEnabled) {
          setIsLookingAtSky(false);
        }
      }

      if (globalInspectData && globalInspectData.timestamp !== inspectData?.timestamp) {
        setInspectData(globalInspectData);
        setIsLookingAtSky(false);
        setCopied(false);
        setShowDeleteConfirm(false); // Reset delete confirmation when new block selected
      } else if (!globalInspectData && inspectData) {
        setInspectData(null);
        setShowDeleteConfirm(false); // Reset when inspector closed
        // Check if we're in inspector mode but no block - means looking at sky
        if (inspectorModeEnabled) {
          setIsLookingAtSky(true);
        }
      } else if (inspectorModeEnabled && !globalInspectData) {
        // In inspector mode but no data = looking at sky
        setIsLookingAtSky(true);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isAdmin, inspectData?.timestamp, isInspectorMode]);

  // Keyboard handler for DELETE key - works both to initiate delete and confirm it
  useEffect(() => {
    if (!canDelete || !inspectData?.sources.state.found || !onDeleteBlock || isDeleting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (showDeleteConfirm) {
          // Already showing confirmation - do the delete
          handleDeleteConfirm();
        } else {
          // Not showing confirmation yet - show it (same as clicking Delete button)
          handleDeleteClick();
        }
      } else if (e.key === 'Escape' && showDeleteConfirm) {
        e.preventDefault();
        setShowDeleteConfirm(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canDelete, inspectData?.sources.state.found, onDeleteBlock, showDeleteConfirm, isDeleting, handleDeleteConfirm, handleDeleteClick]);

  if (isAdmin) {
    return (
      <div className="fixed top-2 left-2 z-50 text-xs flex flex-row items-start gap-2">
        <div className="flex flex-col gap-1">
        <div
          id="fps-display"
          className="pointer-events-none"
          style={{
            borderRadius: '6px',
            border: '1px solid hsla(var(--hud-border))',
            background: 'hsla(var(--hud-bg))',
            color: 'hsl(var(--hud-text))',
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
        {/* Inspector Mode: Looking at sky */}
        {isInspectorMode && isLookingAtSky && !inspectData && (
          <div
            style={{
              borderRadius: '6px',
              border: '1px solid hsla(200, 70%, 60%, 0.8)',
              background: 'hsla(200, 30%, 20%, 0.98)',
              color: 'hsl(200, 80%, 90%)',
              fontFamily: 'monospace',
              padding: '8px 10px',
              fontSize: '11px',
              lineHeight: '1.5',
              position: 'relative',
              minWidth: '280px',
              maxWidth: '320px',
            }}
          >
            {/* Header with close button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', borderBottom: '1px solid hsla(200, 50%, 50%, 0.5)', paddingBottom: '4px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '12px' }}>BLOCK INSPECTOR</span>
              <button
                onClick={handleDismiss}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'hsl(200, 60%, 70%)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  lineHeight: '1',
                  padding: '0 4px',
                }}
                title="Close (ESC or Ctrl+I)"
              >
                ×
              </button>
            </div>
            <div style={{ textAlign: 'center', padding: '12px 0', color: 'hsl(200, 60%, 75%)' }}>
              You are highlighting the sky
            </div>
            <div style={{ fontSize: '10px', color: 'hsl(200, 40%, 60%)', textAlign: 'center' }}>
              Press ESC or Ctrl+I to exit Inspector Mode
            </div>
          </div>
        )}
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
                title={isInspectorMode ? 'Close (ESC or Ctrl+I)' : 'Close'}
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
                  <div>Owner: {inspectData.sources.state.userId ? (
                    <span>
                      {ownerName && <span style={{ color: 'hsl(120, 60%, 70%)', fontWeight: 'bold' }}>{ownerName}</span>}
                      <div style={{ color: 'hsl(200, 50%, 65%)', fontSize: '9px', marginLeft: ownerName ? '0' : '0' }}>
                        {inspectData.sources.state.userId}
                      </div>
                    </span>
                  ) : 'unowned'}</div>
                  <div>Created: {inspectData.sources.state.createdAt ? (() => {
                    const d = new Date(inspectData.sources.state.createdAt);
                    if (isNaN(d.getTime())) return 'invalid';
                    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const y = d.getFullYear();
                    const m = months[d.getMonth()];
                    const day = String(d.getDate()).padStart(2, '0');
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    return `${y}-${m}-${day} ${hh}:${mm}`;
                  })() : 'unknown'}</div>
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
        <VersionBadge />
      </div>
    );
  }

  return (
    <div className="fixed top-2 left-2 z-50 text-xs flex flex-row items-start gap-2">
      <div
        id="fps-display"
        className="pointer-events-none"
        style={{
          borderRadius: '6px',
          border: '1px solid hsla(var(--hud-border))',
          background: 'hsla(var(--hud-bg))',
          color: 'hsl(var(--hud-text))',
          fontFamily: 'Inter, sans-serif',
          padding: '4px 8px',
        }}
      >
        FPS: --
      </div>
      <VersionBadge />
    </div>
  );
}

function VersionBadge() {
  const debug = useDebugStatus();
  return (
    <div
      className="pointer-events-none"
      style={{
        borderRadius: '6px',
        background: 'hsla(150, 60%, 35%, 0.55)',
        color: 'hsl(150, 80%, 95%)',
        fontFamily: 'Inter, sans-serif',
        padding: '4px 8px',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.03em',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}
      title="Build version — bumped on every code push"
    >
      <span>v{APP_VERSION}</span>
      {debug && (
        <span style={{ fontSize: '10px', fontWeight: 400, opacity: 0.85 }}>
          {debug}
        </span>
      )}
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
