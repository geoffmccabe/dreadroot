// SiegeTeleportMenu — the quick-travel menu, rendered OUTSIDE the Canvas in the
// game's HUD style (translucent blue + blur, matching the other panels). Shown
// while Ctrl/Cmd+J has armed jump mode; the in-Canvas SiegeTeleport owns the keys
// + camera and toggles the store. Entries are clickable (and the keyboard slot /
// letter shortcuts still work). It stays open until you pick a spot or press Esc.
import { useSyncExternalStore } from 'react';
import { SIEGE_TELEPORTS, SIEGE_DEMOS } from './siegeAreas';
import { getSiegeAdmin } from './siegeAdmin';
import { isTeleportArmed, subscribeTeleport, setTeleportArmed, siegeJump } from './teleportStore';
import { useActiveGame } from '@/config/activeGame';

const wrap: React.CSSProperties = {
  position: 'fixed', left: '50%', bottom: 96, transform: 'translateX(-50%)', zIndex: 50,
  width: 'min(520px, 92vw)', maxHeight: '60vh', overflowY: 'auto',
  padding: '12px 14px', textAlign: 'center',
  background: 'hsla(var(--hud-bg))',
  border: '1px solid hsla(var(--hud-border))',
  borderRadius: 'var(--hud-radius)',
  backdropFilter: 'var(--hud-blur)', WebkitBackdropFilter: 'var(--hud-blur)',
  color: 'hsl(var(--hud-text))', fontFamily: 'var(--hud-font)', fontSize: 12,
  boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
};
const headStyle: React.CSSProperties = {
  fontWeight: 700, color: 'hsl(var(--hud-text-bright))', marginBottom: 6, letterSpacing: 0.4,
};
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 };
const cell: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
  padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
  background: 'hsla(var(--hud-bg-dim))', border: '1px solid hsla(var(--hud-border))',
  color: 'hsl(var(--hud-text))', font: 'inherit',
};
const keyBadge: React.CSSProperties = {
  flexShrink: 0, minWidth: 16, textAlign: 'center', fontWeight: 800,
  color: 'hsl(var(--hud-text-bright))',
};

export function SiegeTeleportMenu() {
  const active = useActiveGame();
  const armed = useSyncExternalStore(subscribeTeleport, isTeleportArmed, () => false);
  if (active !== 'siege-worlds' || !armed) return null;

  const go = (mapId: string, pos: [number, number, number], yaw?: number, pitch?: number) => {
    siegeJump(mapId, pos, yaw, pitch);
    setTeleportArmed(false);
  };

  return (
    <div style={wrap}>
      <div style={headStyle}>⌖ Jump To</div>
      <div style={grid}>
        {SIEGE_TELEPORTS.map((t) => (
          <button key={t.key ?? t.slot} style={cell} onClick={() => go(t.mapId ?? 'siege-test', t.pos, t.yaw, t.pitch)}>
            <span style={keyBadge}>{t.key ?? t.slot}</span><span>{t.name}</span>
          </button>
        ))}
      </div>
      <div style={{ ...headStyle, marginTop: 10 }}>⊹ Asset Demos</div>
      <div style={grid}>
        {SIEGE_DEMOS.filter((d) => !d.adminOnly || getSiegeAdmin()).map((d) => (
          <button key={d.mapId} style={cell} onClick={() => go(d.mapId, d.pos, d.yaw, d.pitch)}>
            <span style={keyBadge}>{d.key}</span><span>{d.name}</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'hsl(var(--hud-text-dim))' }}>
        Click a spot, press its key, or Shift+# to save here · Esc closes
      </div>
    </div>
  );
}
