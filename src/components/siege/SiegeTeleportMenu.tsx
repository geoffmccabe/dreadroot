// SiegeTeleportMenu — the styled quick-travel menu, rendered OUTSIDE the Canvas
// with the game's CSS (waterfall-card = translucent + blur), like SiegeDebugOverlay.
// Shows while Ctrl/Cmd+J armed jump mode (5s); the in-Canvas SiegeTeleport
// owns the keys + camera and toggles the store.
import { useSyncExternalStore } from 'react';
import { Card } from '@/components/ui/card';
import { SIEGE_TELEPORTS, SIEGE_DEMOS } from './siegeAreas';
import { isTeleportArmed, subscribeTeleport } from './teleportStore';
import { useActiveGame } from '@/config/activeGame';

export function SiegeTeleportMenu() {
  const active = useActiveGame();
  const armed = useSyncExternalStore(subscribeTeleport, isTeleportArmed, () => false);
  if (active !== 'siege-worlds' || !armed) return null;
  return (
    <Card className="waterfall-card fixed left-1/2 bottom-24 -translate-x-1/2 z-50 pointer-events-none px-4 py-3 text-center font-mono text-xs">
      <div className="mb-2 font-bold text-primary">⌖ Jump To:</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-left">
        {SIEGE_TELEPORTS.map((t) => (
          <div key={t.slot} className="text-muted-foreground">
            <b className="text-foreground">{t.slot}</b>&nbsp; {t.name}
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-border/40 font-bold text-primary">⊹ Asset Demos:</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-left">
        {SIEGE_DEMOS.map((d) => (
          <div key={d.mapId} className="text-muted-foreground">
            <b className="text-foreground">{d.key}</b>&nbsp; {d.name}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground">Shift+# saves here · Esc or 5s cancels</div>
    </Card>
  );
}
