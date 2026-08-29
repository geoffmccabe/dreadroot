import React from 'react';
import { getThrowable, useThrowables } from '@/config/throwables';

// The lethal readout: what G will throw next, and how many are left.
//
// Sits beside the ammo counter in the bottom-centre HUD cluster, the way every
// shooter shows grenades. Replaces the old presentation, which put the grenade
// in a hand box with a flashing red "pin pulled" border — a weapon-shaped slot
// for something that is really a count.
//
// The next throwable is the one in the LOWEST-NUMBERED quick-bar slot, which is
// the same rule the throw itself uses, so what this shows is always what leaves
// your hand. Hidden entirely when you are carrying none.
export function ThrowableCounter({
  equippedItems,
}: {
  equippedItems: Array<{ slot: number; itemId: string; quantity?: number }>;
}) {
  useThrowables();   // re-render once the catalogue loads

  let next: { slot: number; count: number; tier: number; sprite: string | null; name: string } | null = null;
  for (const e of equippedItems) {
    const t = getThrowable(e.itemId);
    if (!t) continue;
    if (next && e.slot >= next.slot) continue;
    next = { slot: e.slot, count: e.quantity ?? 1, tier: t.tier, sprite: t.spriteUrl, name: t.name };
  }
  if (!next) return null;

  return (
    <div
      title={`${next.name} — G throws (quick bar slot ${next.slot})`}
      style={{
        position: 'fixed', bottom: 80, left: '50%',
        transform: 'translateX(calc(-50% - 104px))',
        zIndex: 21, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'var(--hud-font, monospace)', fontVariantNumeric: 'tabular-nums',
        color: 'hsl(var(--hud-text-bright))',
        textShadow: '0 1px 3px rgba(0,0,0,0.8)',
      }}
    >
      <div style={{ position: 'relative', width: 26, height: 26, flex: '0 0 auto' }}>
        {next.sprite ? (
          <img
            src={next.sprite}
            alt={next.name}
            draggable={false}
            style={{ width: 26, height: 26, objectFit: 'contain', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
          />
        ) : (
          <span style={{ fontSize: 20, lineHeight: '26px' }} aria-hidden>💣</span>
        )}
        {next.tier > 1 ? (
          <span style={{
            position: 'absolute', top: -3, left: -3, fontSize: 9, fontWeight: 700,
            color: 'hsl(var(--hud-text-dim))',
          }}>T{next.tier}</span>
        ) : null}
      </div>
      <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>{next.count}</span>
      <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.55, letterSpacing: 1 }}>G</span>
    </div>
  );
}
