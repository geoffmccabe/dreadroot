// PlayerDamageHealthBar — a big, brief health readout that flashes onto the screen the
// instant the player takes damage (or drinks a healing potion). Shared by ALL games via
// healthBarStore (pulsed from the central damage pipeline). It is invisible the rest of
// the time.
//
// Spec: centered, 75% down the screen. Bar = 1/3 of screen width, a wide thin rectangle
// with a thick (20px) black frame; the fill = HP% of the width, coloured by how low you
// are (red→orange→yellow→green); the empty part is black. To its right, large white text
// shows the % to one decimal (trailing ".0" dropped: 47.0%→47%, 1.2%→1.2%). On a hit it
// appears instantly, holds for 1s, then fades over 0.5s.
import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { subscribeHealthBar, getHealthBarState } from './healthBarStore';

const HOLD_MS = 1000;
const FADE_MS = 500;
const TOTAL_MS = HOLD_MS + FADE_MS;
const FLASH_MS = 100;          // red screen tint on a hit (~1/10s)
const FLASH_MAX = 0.4;         // peak red opacity

// Fill colour per HP band, as a left→right gradient: full saturation on the left fading to
// 50% saturation toward the low-health (right) end of the bar.
function fillGradient(pct: number): string {
  const [h, s, l] =
    pct < 10 ? [0, 73, 56] :    // red
    pct < 25 ? [34, 100, 56] :  // orange
    pct < 50 ? [51, 100, 56] :  // yellow
               [133, 61, 51];   // green
  return `linear-gradient(to right, hsl(${h} ${s}% ${l}%), hsl(${h} ${Math.round(s * 0.5)}% ${l}%))`;
}

function fmtPct(pct: number): string {
  const s = pct.toFixed(1);
  return (s.endsWith('.0') ? s.slice(0, -2) : s) + '%';
}

export function PlayerDamageHealthBar() {
  const st = useSyncExternalStore(subscribeHealthBar, getHealthBarState, getHealthBarState);
  const [, setTick] = useState(0);

  // While the bar is alive (within TOTAL_MS of the last pulse), re-render each frame so the
  // fade is smooth. The loop stops itself once the window passes — zero cost when idle.
  useEffect(() => {
    if (st.shownAt < 0) return;
    let raf = 0;
    const loop = () => {
      const el = performance.now() - st.shownAt;
      setTick((t) => t + 1);
      if (el < TOTAL_MS) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [st.shownAt]);

  if (st.shownAt < 0) return null;
  const elapsed = performance.now() - st.shownAt;
  if (elapsed >= TOTAL_MS) return null;

  const opacity = elapsed < HOLD_MS ? 1 : 1 - (elapsed - HOLD_MS) / FADE_MS;
  const pct = Math.max(0, Math.min(100, (st.current / st.max) * 100));
  const fill = fillGradient(pct);
  // Brief red full-screen tint on a hit (not on a heal), fading out over ~1/10s.
  const flash = st.damage && elapsed < FLASH_MS ? FLASH_MAX * (1 - elapsed / FLASH_MS) : 0;

  return (
    <>
    {flash > 0 && (
      <div style={{
        position: 'fixed', inset: 0, background: '#ff0000', opacity: flash,
        pointerEvents: 'none', zIndex: 69,
      }} />
    )}
    <div
      style={{
        position: 'fixed', top: '75%', left: 0, width: '100vw',
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px',
        pointerEvents: 'none', zIndex: 70, opacity,
        transform: 'translateY(-50%)',
      }}
    >
      {/* The bar: 1/3 screen width, 20px black frame, black (empty) interior. */}
      <div
        style={{
          width: '33.33vw', height: 64, boxSizing: 'border-box',
          border: '20px solid rgba(0,0,0,0.6)', background: 'rgba(0,0,0,0.6)', overflow: 'hidden',
          borderRadius: 'var(--hud-radius, 8px)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
        }}
      >
        {/* Gradient anchored to the FULL inner bar width (not the fill), so the desaturated
            end always sits at the bar's right edge and the fill reveals it from the left. */}
        <div style={{
          width: `${pct}%`, height: '100%', background: fill,
          backgroundSize: 'calc(33.33vw - 40px) 100%', backgroundRepeat: 'no-repeat',
          backgroundPosition: 'left center', transition: 'none',
        }} />
      </div>
      {/* The % readout, large white, to the right of the bar. */}
      <div
        style={{
          color: '#fff', fontWeight: 900, fontSize: 'min(6vw, 56px)', lineHeight: 1,
          fontFamily: 'system-ui, sans-serif', letterSpacing: '-0.02em',
          textShadow: '0 2px 6px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)',
          whiteSpace: 'nowrap',
        }}
      >
        {fmtPct(pct)}
      </div>
    </div>
    </>
  );
}
