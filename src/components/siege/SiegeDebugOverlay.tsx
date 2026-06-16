// SW debug readout — small on-screen panel of live siege state so we can SEE why
// behaviors do/don't fire (God Mode, terrain-walk, colliders, fps). Reads the sdbg store.
// Renders nothing outside Siege Worlds. Temporary debug aid.
import { useEffect, useState, useRef } from 'react';
import { Card } from '@/components/ui/card';
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
    <div className={warn ? 'text-destructive' : 'text-muted-foreground'}>
      {k}: <b className="text-foreground">{String(v)}</b>
    </div>
  );
  return (
    <Card className="waterfall-card fixed left-2 top-[23px] z-50 min-w-[168px] pointer-events-none font-mono text-[11px] leading-relaxed">
      <div className="mb-1 font-bold text-primary">⚔ SIEGE DEBUG</div>
      {row('fps', fps.current, fps.current < 25)}
      {row('ctrl-sees-siege', sdbg.isSiege, !sdbg.isSiege)}
      {row('godMode', sdbg.godMode, sdbg.godMode)}
      {row('terrain-walk', sdbg.ghf, !sdbg.ghf)}
      {row('onGround', sdbg.onGround)}
      {row('playerY', sdbg.playerY.toFixed(1))}
      {row('terrainY', sdbg.terrainY == null ? 'NULL' : sdbg.terrainY.toFixed(1), sdbg.terrainY == null)}
      {row('monsters', sdbg.monsters)}
    </Card>
  );
}
