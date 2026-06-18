// CombatTelemetry — two mount points for the combat recorder (combatTelemetry.ts):
//   <CombatTelemetryProbe/>   lives INSIDE the R3F Canvas; feeds the player (camera)
//                             position to the recorder every frame.
//   <CombatTelemetryOverlay/> lives in the DOM (outside Canvas); shows a live readout
//                             (your HP, nearest monster distance, # tracked) and gives
//                             Pause + Copy controls. Ctrl+Shift+P toggles pause.
import { useEffect, useSyncExternalStore, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  recordSnapshot, subscribeTelemetry, getTelemetryLive, isTelemetryPaused,
  getTelemetryCount, toggleTelemetryPaused, setTelemetryPaused, clearTelemetry, copyTelemetry,
} from './combatTelemetry';

// --- Probe: inside the Canvas ---
export function CombatTelemetryProbe() {
  useFrame(({ camera }) => {
    recordSnapshot(camera.position.x, camera.position.y, camera.position.z);
  });
  return null;
}

// --- Overlay: in the DOM ---
const subscribe = (cb: () => void) => subscribeTelemetry(cb);
// snapshot for useSyncExternalStore — a primitive string so identical frames don't re-render
const getSnap = () => {
  const l = getTelemetryLive();
  return `${isTelemetryPaused() ? 1 : 0}|${Math.round(l.hp)}|${l.nearest.dist.toFixed(1)}|${l.monCount}|${getTelemetryCount()}`;
};

export function CombatTelemetryOverlay() {
  const snap = useSyncExternalStore(subscribe, getSnap, getSnap);
  const [paused, hpS, distS, monS, countS] = snap.split('|');
  const isPaused = paused === '1';
  const [copied, setCopied] = useState(false);

  // Ctrl+Shift+P toggles pause (Cmd-P = Print, Ctrl-P = shpider — both taken).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'KeyP')) {
        e.preventDefault();
        toggleTelemetryPaused();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onCopy = useCallback(async () => {
    const ok = await copyTelemetry();
    setCopied(ok);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const nearDist = parseFloat(distS);
  const distColor = nearDist < 3 ? '#ff5555' : nearDist < 6 ? '#ffcc44' : '#8fd';

  return (
    <div style={{
      position: 'fixed', top: 96, right: 8, zIndex: 60,
      width: 196, padding: '8px 10px',
      background: 'rgba(8,10,16,0.82)', border: '1px solid rgba(120,140,180,0.35)',
      borderRadius: 8, color: '#cfe', font: '11px/1.5 ui-monospace, Menlo, monospace',
      pointerEvents: 'auto', userSelect: 'none', backdropFilter: 'blur(3px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>COMBAT TRACKER</span>
        <span style={{ color: isPaused ? '#ffcc44' : '#6c8' }}>{isPaused ? '❚❚ PAUSED' : '● REC'}</span>
      </div>
      <div>your HP: <b>{hpS}</b></div>
      <div>nearest: <b style={{ color: distColor }}>{distS}m</b></div>
      <div>tracked: {monS}   rows: {countS}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={() => setTelemetryPaused(!isPaused)} style={btn}>
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button onClick={onCopy} style={btn}>{copied ? 'Copied!' : 'Copy'}</button>
        <button onClick={() => clearTelemetry()} style={btn}>Clear</button>
      </div>
      <div style={{ marginTop: 4, opacity: 0.6, fontSize: 9 }}>Ctrl+Shift+P = pause</div>
    </div>
  );
}

const btn: React.CSSProperties = {
  flex: 1, padding: '3px 4px', fontSize: 10, cursor: 'pointer',
  background: 'rgba(60,80,120,0.5)', color: '#def',
  border: '1px solid rgba(120,140,180,0.4)', borderRadius: 5,
};
