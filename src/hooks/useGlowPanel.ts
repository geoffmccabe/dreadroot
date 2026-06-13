// useGlowPanel — the Kinetik-style interactive panel glow, as a reusable hook so
// every panel uses the SAME behaviour (and it ports identically to other games;
// the glow color is the per-game --primary token).
//
// Behaviour: trigger() turns the glow ON instantly, holds it ~3s, then fades it
// out over 3s. Calling trigger() again (panel opened / moved / resized) resets the
// hold. The glow is the panel's OWN box-shadow (so it isn't clipped by the panel's
// overflow:hidden and renders outward):
//   const glow = useGlowPanel();
//   <div style={{ boxShadow: glow.boxShadow, transition: `…, ${glow.glowTransition}` }} … />
//   useEffect(() => { if (open) glow.trigger(); }, [open]);  // + on drag/resize start

import { useCallback, useEffect, useRef, useState } from 'react';

const HOLD_MS = 3000;   // glow stays fully on this long after the last trigger
const FADE_MS = 3000;   // then fades out over this long
const ON_MS = 150;      // fast fade-in when it (re)triggers

// Float shadow (always present) + the accent glow ring (added while glowing).
const BASE_SHADOW = '0 10px 30px -8px rgb(0 0 0 / 0.45), 0 4px 12px -4px rgb(0 0 0 / 0.3)';
const GLOW_RING = '0 0 0 2px hsl(var(--primary) / 0.6), 0 0 22px 3px hsl(var(--primary) / 0.4)';

export function useGlowPanel() {
  const [on, setOn] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  const trigger = useCallback(() => {
    setOn(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOn(false), HOLD_MS);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return {
    trigger,
    glowing: on,
    boxShadow: on ? `${GLOW_RING}, ${BASE_SHADOW}` : BASE_SHADOW,
    glowTransition: `box-shadow ${on ? ON_MS : FADE_MS}ms ease`,
  };
}
