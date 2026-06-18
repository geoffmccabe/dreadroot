// ChallengeResultPanel — the post-challenge screen (win or lose). Reads challengeStore.result (set
// by ChallengeRunner on finish/death) and lets the player retry the same challenge, pick another
// from the Browser, or close to free-roam. Completes the play loop so a finished challenge doesn't
// strand the player in the empty arena. DOM portal; mounted in the Fortress shell.
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getChallengeState, subscribeChallenge, setChallengeState } from './challengeStore';
import { fireChallengeStart } from './challengeControl';
import { setBrowserOpen } from './challengeBrowserStore';

const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const btn = (kind: 'go' | 'alt' | 'plain'): React.CSSProperties => ({
  background: kind === 'go' ? '#2e8b57' : kind === 'alt' ? '#3a6ea8' : 'hsla(220,25%,22%,0.9)',
  border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 7, color: '#e8eefb',
  padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
});

export function ChallengeResultPanel() {
  const st = useSyncExternalStore(subscribeChallenge, getChallengeState, getChallengeState);
  const res = st.result;

  // Free the cursor so the buttons are clickable (the game holds pointer-lock during play).
  useEffect(() => { if (res) document.exitPointerLock?.(); }, [res]);

  if (!res) return null;
  const win = res.outcome === 'win';
  const close = () => setChallengeState({ result: null });
  const playAgain = () => { const ch = res.challenge; close(); fireChallengeStart(ch); };
  const browse = () => { close(); setBrowserOpen(true); };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 124, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}>
      <div style={{ width: 360, background: 'hsla(222, 32%, 10%, 0.97)', border: `1px solid ${win ? 'hsla(140,50%,55%,0.5)' : 'hsla(0,55%,55%,0.5)'}`, borderRadius: 14, boxShadow: '0 14px 60px #000', color: '#e8eefb', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 1, color: win ? '#8fe6a0' : '#ff9b9b' }}>{win ? 'VICTORY!' : 'DEFEATED'}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#cfe3ff', marginTop: 4 }}>{res.name}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 16 }}>
          <div><div style={{ fontSize: 11, color: '#9fb4d0', fontWeight: 600 }}>SCORE</div><div style={{ fontSize: 22, fontWeight: 900, color: '#ffd27f' }}>{res.score.toLocaleString()}</div></div>
          <div><div style={{ fontSize: 11, color: '#9fb4d0', fontWeight: 600 }}>WAVE</div><div style={{ fontSize: 22, fontWeight: 900 }}>{res.wave}/{res.totalWaves}</div></div>
          <div><div style={{ fontSize: 11, color: '#9fb4d0', fontWeight: 600 }}>TIME</div><div style={{ fontSize: 22, fontWeight: 900 }}>{fmtTime(res.timeMs)}</div></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 22 }}>
          <button style={btn('go')} onClick={playAgain}>▶ Play Again</button>
          <button style={btn('alt')} onClick={browse}>📂 Choose Another</button>
          <button style={btn('plain')} onClick={close}>✕ Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
