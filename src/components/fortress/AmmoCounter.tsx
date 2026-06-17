import React from 'react';
import { useAmmo } from '@/config/weaponAmmo';

// Small bottom-center ammo readout for the equipped weapon. Hidden when no weapon
// with a clip is equipped (max === null).
export function AmmoCounter() {
  const ammo = useAmmo();
  if (ammo.max == null) return null;

  const low = !ammo.reloading && ammo.current <= Math.max(1, Math.ceil(ammo.max * 0.2));

  return (
    <div
      style={{
        position: 'fixed', bottom: 84, left: '50%', transform: 'translateX(-50%)',
        zIndex: 21, pointerEvents: 'none',
        fontFamily: 'var(--hud-font, monospace)', fontVariantNumeric: 'tabular-nums',
        color: ammo.reloading ? 'hsl(var(--hud-text-dim))' : low ? '#ff6b6b' : 'hsl(var(--hud-text-bright))',
        textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        fontSize: 18, fontWeight: 700, letterSpacing: 1,
        display: 'flex', alignItems: 'baseline', gap: 6,
      }}
    >
      {ammo.reloading ? (
        <span style={{ fontSize: 13, fontWeight: 600 }}>Reloading…</span>
      ) : (
        <>
          <span>{ammo.current}</span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>/ {ammo.reserve === Infinity ? '∞' : ammo.reserve}</span>
        </>
      )}
    </div>
  );
}
