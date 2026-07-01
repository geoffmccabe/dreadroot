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
    `fwd: [${f3(sdbg.fwdX)}, ${f3(sdbg.fwdY)}, ${f3(sdbg.fwdZ)}]  ` +
    `| cc_map:${sdbg.cc_map || '—'} cc_mesh:${sdbg.cc_mesh} cc_on:${sdbg.cc_on} ` +
    `cc_hit:${sdbg.cc_hit} cc_push:${sdbg.cc_push.toFixed(2)} cc_mode:${sdbg.cc_mode || '—'} ` +
    `cc_feetY:${sdbg.cc_feetY.toFixed(2)} cc_dist:${sdbg.cc_dist.toFixed(2)} cc_pl:${sdbg.cc_pl} ` +
    `cc_pathN:${sdbg.cc_pathN} cc_stuckMs:${sdbg.cc_stuckMs}`;
  const copy = () => {
    navigator.clipboard.writeText(copyText)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
      .catch(() => {});
  };

  return (
    <div
      style={{
        position: 'fixed', left: pos.left, top: pos.top, width: 220, zIndex: 50,
        color: 'var(--pt-debug-body-color)', font: 'var(--pt-debug-body-size) var(--pt-debug-body-family)', lineHeight: 1.5,
        background: 'var(--pt-debug-bg)', border: 'var(--pt-debug-border-w) solid var(--pt-debug-border)',
        borderRadius: 'var(--pt-debug-radius)', padding: '8px 10px', pointerEvents: 'auto',
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      <div {...handleProps} style={{ ...handleProps.style, color: 'var(--pt-debug-heading-color)', fontWeight: 700, marginBottom: 4 }}>
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
      {row('cc_map', sdbg.cc_map || '—', sdbg.cc_map !== 'city-demo')}
      {row('cc_mesh', sdbg.cc_mesh, !sdbg.cc_mesh)}
      {row('cc_on', sdbg.cc_on, !sdbg.cc_on)}
      {row('cc_hit', sdbg.cc_hit, !sdbg.cc_hit)}
      {row('cc_push', sdbg.cc_push.toFixed(2))}
      {row('cc_mode', sdbg.cc_mode || '—')}
      {row('cc_feetY', sdbg.cc_feetY.toFixed(2))}
      {row('cc_dist', sdbg.cc_dist.toFixed(2))}
      {row('cc_pl', sdbg.cc_pl, !sdbg.cc_pl)}
      {row('cc_pathN', sdbg.cc_pathN, sdbg.cc_pathN < 0)}
      {row('cc_stuckMs', sdbg.cc_stuckMs)}
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
