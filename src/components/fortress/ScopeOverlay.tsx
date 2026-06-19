// Phase 4 — per-weapon aim-down-sights scope overlay. A full-screen DOM layer
// (rendered outside the R3F Canvas) that fades in when aiming a scoped weapon.
//
// • weapon_stats.scope_graphic_url set  → that image fills the screen.
// • weapon_stats.is_sniper (no image)   → a generic black "tunnel vision"
//   vignette + thin reticle, so snipers feel scoped even before art exists.
// • neither                             → nothing (normal guns don't scope).
//
// Reads the aim + active-weapon module stores directly — no prop threading.
import React from 'react';
import { useAiming } from '@/config/aimState';
import { useActiveWeapon } from '@/config/activeWeapon';

export function ScopeOverlay() {
  const aiming = useAiming();
  const aw = useActiveWeapon();
  const url = aw?.scopeGraphicUrl ?? null;
  const isSniper = !!aw?.isSniper;

  // Only scoped weapons get an overlay. Keep the element mounted and toggle
  // opacity so the fade transition runs both ways.
  const hasOverlay = !!url || isSniper;
  const visible = aiming && hasOverlay;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 30,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 120ms ease-out',
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        // Generic sniper scope: clear center circle, black surround, hairlines.
        <>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 28vh, rgba(0,0,0,0.55) 30vh, #000 38vh)',
          }} />
          <div style={{
            position: 'absolute', top: '50%', left: 0, right: 0, height: 1,
            background: 'rgba(0,0,0,0.85)',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1,
            background: 'rgba(0,0,0,0.85)',
          }} />
        </>
      )}
    </div>
  );
}
