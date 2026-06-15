// SiegeWorld — the top-level mount for a Siege Worlds world: the R3F <Canvas>
// plus the HUD overlay (controls, coords, and the village placement editor).

import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { getWorldDefinition } from '@/config/worldDefinition';
import { APP_VERSION } from '@/version';
import { SiegeWorldScene } from './SiegeWorldScene';
import { ControlsPanel } from './ControlsPanel';
import { CoordsHud } from './CoordsHud';
import { TriagePanel } from './TriagePanel';
import { SiegeHUD } from './SiegeHUD';
import { placementState } from './placementState';

type TMode = 'translate' | 'rotate' | 'scale';

interface Props {
  worldId?: string;
}

export function SiegeWorld({ worldId = 'siege-test' }: Props) {
  const world = getWorldDefinition(worldId);
  const [editorMode, setEditorMode] = useState(false);
  const [mode, setMode] = useState<TMode>('translate');
  const [charAnim] = useState('character@idle aiming');
  const [, tick] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!editorMode) return;
    const id = setInterval(() => tick((n) => n + 1), 150);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Digit1') setMode('translate');
      if (e.code === 'Digit2') setMode('rotate');
      if (e.code === 'Digit3') setMode('scale');
    };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(id); window.removeEventListener('keydown', onKey); };
  }, [editorMode]);

  const copyTransform = () => {
    const p = placementState;
    const txt = `Village placement:\n  pos: [${p.pos.map((n) => n.toFixed(1)).join(', ')}]\n  rot(deg): [${p.rotDeg.join(', ')}]\n  scale: ${p.scale.toFixed(3)}`;
    navigator.clipboard?.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  };

  const btn = (active: boolean): React.CSSProperties => ({
    pointerEvents: 'auto', cursor: 'pointer', font: '12px ui-monospace, monospace',
    color: '#fff', background: active ? 'rgba(70,130,180,0.9)' : 'rgba(0,0,0,0.55)',
    border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '3px 9px', marginRight: 6,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b1016' }}>
      <Canvas
        camera={{ fov: 70, near: 0.1, far: 12000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
      >
        <SiegeWorldScene world={world} editorMode={editorMode} transformMode={mode} charAnim={charAnim} />
      </Canvas>

      {/* Crosshair (hidden while editing) */}
      {!editorMode && (
        <div style={{
          position: 'fixed', left: '50%', top: '50%', width: 6, height: 6,
          marginLeft: -3, marginTop: -3, borderRadius: '50%',
          background: 'rgba(255,255,255,0.85)', pointerEvents: 'none',
        }} />
      )}

      {/* Build + controls HUD */}
      <div style={{
        position: 'fixed', left: 10, bottom: 10, color: 'rgba(255,255,255,0.85)',
        font: '12px ui-monospace, monospace', textShadow: '0 1px 2px #000', pointerEvents: 'none',
      }}>
        <div><strong>Siege Worlds</strong> · {world.name} · v{APP_VERSION}</div>
        {editorMode && <div>Drag the gizmo · orbit: mouse · 1 move · 2 rotate · 3 scale</div>}
      </div>

      {/* Village placement editor controls */}
      <div style={{ position: 'fixed', left: 10, top: 10 }}>
        <button style={btn(editorMode)} onClick={() => setEditorMode((v) => !v)}>
          {editorMode ? 'Exit Village Editor' : 'Edit Village'}
        </button>
        {editorMode && (
          <div style={{ marginTop: 6 }}>
            <button style={btn(mode === 'translate')} onClick={() => setMode('translate')}>Move</button>
            <button style={btn(mode === 'rotate')} onClick={() => setMode('rotate')}>Rotate</button>
            <button style={btn(mode === 'scale')} onClick={() => setMode('scale')}>Scale</button>
            <div style={{
              marginTop: 8, color: '#fff', font: '12px ui-monospace, monospace',
              background: 'rgba(0,0,0,0.55)', padding: 8, borderRadius: 4, width: 260,
            }}>
              <div>pos [{placementState.pos.map((n) => n.toFixed(1)).join(', ')}]</div>
              <div>rot° [{placementState.rotDeg.join(', ')}]</div>
              <div>scale {placementState.scale.toFixed(3)}</div>
              <button style={{ ...btn(false), marginTop: 6, background: copied ? 'rgba(60,160,90,0.9)' : 'rgba(0,0,0,0.55)' }} onClick={copyTransform}>
                {copied ? 'Copied!' : 'Copy transform'}
              </button>
            </div>
          </div>
        )}
      </div>

      <ControlsPanel />
      {!editorMode && <CoordsHud />}
      {!editorMode && <TriagePanel />}
      {!editorMode && <SiegeHUD />}
    </div>
  );
}

export default SiegeWorld;
