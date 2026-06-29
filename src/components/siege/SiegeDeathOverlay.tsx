// SiegeDeathOverlay — shown when the player dies in a siege OPEN WORLD / test map (NOT a challenge —
// those use the ChallengeResultPanel). Keeps the world visible behind a 50% darkening layer and offers
// RESPAWN (revive in place, to keep testing) or RETURN (revive + go back where you came from). It does
// NOT auto-respawn/teleport, so the world never disappears out from under you.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

const btn = (bg: string): React.CSSProperties => ({
  background: bg, border: '1px solid hsla(210,30%,50%,0.5)', borderRadius: 8, color: '#fff',
  padding: '12px 30px', fontSize: 17, fontWeight: 800, letterSpacing: 1, cursor: 'pointer',
  boxShadow: '0 6px 22px #000', fontFamily: 'inherit',
});

export function SiegeDeathOverlay({ visible, onRespawn, onReturn }: { visible: boolean; onRespawn: () => void; onReturn: () => void }) {
  // Free the cursor (FPS pointer-lock) so the buttons are clickable.
  useEffect(() => { if (visible) document.exitPointerLock?.(); }, [visible]);
  if (!visible) return null;

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 61, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)',
      fontFamily: 'var(--hud-font, Inter, sans-serif)',
    }}>
      <div style={{ fontSize: 'min(9vw, 64px)', fontWeight: 900, color: '#ff5a5a', letterSpacing: 2, textShadow: '0 3px 18px #000' }}>YOU DIED</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 26 }}>
        <button style={btn('#2e8b57')} onClick={onRespawn}>RESPAWN</button>
        <button style={btn('#3a6ea8')} onClick={onReturn}>RETURN</button>
      </div>
      <div style={{ marginTop: 16, fontSize: 13, color: '#cfe3ff', textShadow: '0 2px 8px #000' }}>
        RESPAWN here to keep testing&nbsp;·&nbsp;RETURN to where you came from
      </div>
    </div>,
    document.body,
  );
}
