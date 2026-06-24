// HoverbikePrompt — bottom-centre HUD prompt shown while the player stands within 2m of the hoverbike.
// Styled like the lobby's Magic Chest prompt. The bike can't be ridden yet, so it just tells the player
// a keycard is required (a hint that it IS rideable, later).
import { useSyncExternalStore } from 'react';
import { subscribeHoverbike, getHoverbikeInRange } from './hoverbikeStore';

export function HoverbikePrompt() {
  const inRange = useSyncExternalStore(subscribeHoverbike, getHoverbikeInRange);
  if (!inRange) return null;
  return (
    <div style={{ position: 'fixed', bottom: 150, left: '50%', transform: 'translateX(-50%)', zIndex: 100, pointerEvents: 'none',
      padding: '10px 18px', borderRadius: 'var(--hud-radius, 10px)', background: 'hsla(205, 50%, 16%, 0.8)',
      border: '1px solid hsla(195, 80%, 60%, 0.6)', color: '#e9f6ff', font: '14px ui-monospace, monospace',
      textShadow: '0 1px 2px rgba(0,0,0,0.8)', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
      🔑 <b>HOVERBIKE</b> — <b style={{ color: 'hsl(48,90%,68%)' }}>Requires Keycard</b>
    </div>
  );
}
