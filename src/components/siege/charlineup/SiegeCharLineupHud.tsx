// SiegeCharLineupHud — DOM readout for the character lineup (the in-canvas part is
// SiegeCharacterLineup). Shows which animation is current, its 1-based number, and the M/N hint.
// Only visible while the lineup is toggled on ("&&&").
import { LINEUP_CHARS, useCharLineup } from './siegeCharLineupState';

export function SiegeCharLineupHud() {
  const { enabled, animIndex, animNames, editTarget, tuneCharIndex } = useCharLineup();
  if (!enabled) return null;

  const total = animNames.length;
  const arm = editTarget === 'arm';
  const who = tuneCharIndex < 0 ? 'ALL' : (LINEUP_CHARS[tuneCharIndex]?.name ?? 'ALL');

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
      {/* WHAT THE ARROWS DO RIGHT NOW. Two tools share them, and without a readout a key acting
          on the wrong one is indistinguishable from a key that does nothing. */}
      <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsla(200,70%,55%,0.25)' }}>
        <span style={{ opacity: 0.55 }}>arrows move the </span>
        <b style={{ color: arm ? '#ffd479' : '#8fd6ff' }}>{arm ? 'LEFT HAND' : 'GUN'}</b>
        <span style={{ opacity: 0.55 }}> on </span><b style={{ color: '#9be8a0' }}>{who}</b>
        <span style={{ opacity: 0.55 }}> — ' to swap</span>
        <div style={{ opacity: 0.75, fontSize: 11, marginTop: 1 }}>
          &larr;&rarr; left/right · &uarr;&darr; up/down · . toward the character · , away
          {arm ? ' · < > swing the elbow · 7 8 twist the wrist' : ''}
        </div>
      </div>
      <div style={{ opacity: 0.5, fontSize: 11, marginTop: 3 }}>1-6 character (0 = all) · M/N animation · ( ) weapon · - = size (_ + coarse) · Shift/Opt+XYZ rotate · [ ] hands apart · {'{'} {'}'} shoulders · K set grip · \\ export</div>
    </div>
  );
}
