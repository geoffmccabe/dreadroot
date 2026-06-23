// SiegeCharLineupHud — DOM readout for the character lineup (the in-canvas part is
// SiegeCharacterLineup). Shows which animation is current, its 1-based number, and the M/N hint.
// Only visible while the lineup is toggled on ("&&&").
import { useCharLineup } from './siegeCharLineupState';

export function SiegeCharLineupHud() {
  const { enabled, animIndex, animNames } = useCharLineup();
  if (!enabled) return null;

  const total = animNames.length;

  const card: React.CSSProperties = {
    position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 1100,
    pointerEvents: 'none', background: 'rgba(8,16,28,0.9)', border: '1px solid hsla(200,70%,55%,0.6)',
    borderRadius: 10, padding: '8px 16px', color: '#e8f3ff', font: '13px ui-monospace, monospace',
    textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  };

  return (
    <div style={card}>
      <div style={{ font: '700 14px ui-monospace, monospace', color: '#8fd6ff', letterSpacing: 1 }}>CHARACTER LINEUP</div>
      <div style={{ marginTop: 3 }}>
        {total ? (
          <>Animation <b style={{ color: '#9be8a0' }}>#{(animIndex % total) + 1}</b>
            <span style={{ opacity: 0.6 }}>/{total}</span> — <b>{animNames[animIndex % total]}</b></>
        ) : (
          <span style={{ opacity: 0.7 }}>loading…</span>
        )}
      </div>
      <div style={{ opacity: 0.6, fontSize: 11, marginTop: 2 }}>M = next · N = previous · F = fly (land) · G = fly (wall) · &amp;&amp;&amp; to hide</div>
    </div>
  );
}
