// SW debug readout — small on-screen panel of live siege state so we can SEE why
// behaviors do/don't fire (God Mode, terrain-walk, colliders, fps). Reads the sdbg store.
// Hidden unless work mode (⌘-]) is on. Styled to match the Laser Inspector panel and
// draggable by its title bar. Temporary debug aid.
import { useEffect, useState, useRef } from 'react';
import { sdbg } from './siegeDebug';
import { useActiveGame } from '@/config/activeGame';
import { useWorkMode } from './siegeWorkMode';
import { useDraggablePanel } from './useDraggablePanel';

export function SiegeDebugOverlay() {
  const active = useActiveGame();
  const workMode = useWorkMode();
  const [, tick] = useState(0);
  const [copied, setCopied] = useState(false);
  const fps = useRef(0);
  // Default position: 8px from the left, 20px lower than the old top (23 → 43).
  const { pos, handleProps } = useDraggablePanel({ left: 8, top: 43 });

  useEffect(() => {
    let raf = 0, last = performance.now(), frames = 0, acc = 0;
    const loop = (t: number) => {
      frames++; acc += t - last; last = t;
      if (acc >= 500) { fps.current = Math.round((frames * 1000) / acc); frames = 0; acc = 0; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, []);

  if (active !== 'siege-worlds' || !workMode) return null;
  const row = (k: string, v: string | number | boolean, warn = false) => (
    <div style={{ opacity: warn ? 1 : 0.8, color: warn ? '#ff8a8a' : undefined }}>
      {k}: <b style={{ color: warn ? '#ffb3b3' : '#ffe' }}>{String(v)}</b>
    </div>
  );
  const f3 = (n: number) => n.toFixed(3);
  // The exact drop point + facing, formatted for pasting back as a teleport target.
  const copyText =
    `pos: [${f3(sdbg.playerX)}, ${f3(sdbg.playerY)}, ${f3(sdbg.playerZ)}]  ` +
    `yaw: ${sdbg.yawDeg.toFixed(1)}°  pitch: ${sdbg.pitchDeg.toFixed(1)}°  ` +
    `fwd: [${f3(sdbg.fwdX)}, ${f3(sdbg.fwdY)}, ${f3(sdbg.fwdZ)}]`;
  const copy = () => {
    navigator.clipboard.writeText(copyText)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
      .catch(() => {});
  };

  return (
    <div
      style={{
        position: 'fixed', left: pos.left, top: pos.top, width: 220, zIndex: 50,
        color: 'rgba(255,255,255,0.92)', font: '12px ui-monospace, monospace', lineHeight: 1.5,
        background: 'rgba(8, 24, 16, 0.82)', border: '1px solid rgba(90,200,140,0.55)',
        borderRadius: 12, padding: '8px 10px', pointerEvents: 'auto',
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      <div {...handleProps} style={{ ...handleProps.style, color: '#7fe6a8', fontWeight: 700, marginBottom: 4 }}>
        ⚔ SIEGE DEBUG
      </div>
      {row('fps', fps.current, fps.current < 25)}
      {row('godMode', sdbg.godMode, sdbg.godMode)}
      {row('onGround', sdbg.onGround)}
      {row('x', f3(sdbg.playerX))}
      {row('y', f3(sdbg.playerY))}
      {row('z', f3(sdbg.playerZ))}
      {row('yaw°', sdbg.yawDeg.toFixed(1))}
      {row('pitch°', sdbg.pitchDeg.toFixed(1))}
      {row('fwd', `${f3(sdbg.fwdX)}, ${f3(sdbg.fwdY)}, ${f3(sdbg.fwdZ)}`)}
      {row('terrainY', sdbg.terrainY == null ? 'NULL' : sdbg.terrainY.toFixed(1), sdbg.terrainY == null)}
      {row('monsters', sdbg.monsters)}
      <button
        onClick={copy}
        style={{
          marginTop: 5, width: '100%', pointerEvents: 'auto', cursor: 'pointer',
          font: '11px ui-monospace, monospace', color: '#fff',
          background: copied ? 'rgba(60,160,90,0.9)' : 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, padding: '2px 8px',
        }}
      >
        {copied ? 'Copied!' : 'Copy pos + view'}
      </button>
    </div>
  );
}
