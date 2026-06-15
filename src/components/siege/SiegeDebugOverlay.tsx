// SW debug readout — small on-screen panel of live siege state so we can SEE why
// behaviors do/don't fire (God Mode, terrain-walk, colliders, fps). Reads the sdbg store.
// Renders nothing outside Siege Worlds. Temporary debug aid.
import { useEffect, useState, useRef } from 'react';
import { sdbg } from './siegeDebug';
import { useActiveGame } from '@/config/activeGame';

export function SiegeDebugOverlay() {
  const active = useActiveGame();
  const [, tick] = useState(0);
  const fps = useRef(0);
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

  if (active !== 'siege-worlds') return null;
  const row = (k: string, v: string | number | boolean, warn = false) => (
    <div style={{ color: warn ? '#ff7b7b' : '#9fe' }}>{k}: <b style={{ color: '#fff' }}>{String(v)}</b></div>
  );
  return (
    <div style={{
      position: 'fixed', top: '8px', left: '8px', zIndex: 50, background: 'rgba(0,0,0,0.72)',
      color: '#9fe', font: '11px/1.45 monospace', padding: '6px 9px', borderRadius: '6px',
      pointerEvents: 'none', minWidth: '168px',
    }}>
      <div style={{ color: '#fc6', fontWeight: 700, marginBottom: '3px' }}>⚔ SIEGE DEBUG</div>
      {row('fps', fps.current, fps.current < 25)}
      {row('ctrl-sees-siege', sdbg.isSiege, !sdbg.isSiege)}
      {row('godMode', sdbg.godMode, sdbg.godMode)}
      {row('terrain-walk', sdbg.ghf, !sdbg.ghf)}
      {row('onGround', sdbg.onGround)}
      {row('playerY', sdbg.playerY.toFixed(1))}
      {row('terrainY', sdbg.terrainY == null ? 'NULL' : sdbg.terrainY.toFixed(1), sdbg.terrainY == null)}
      {row('monsters', sdbg.monsters)}
    </div>
  );
}
