// ChallengeHUD — the DOM overlay for a running challenge: the centred "Wave X/10" announcement
// (with wave name / image / advice text, faint + brief on carry-over) and a persistent red
// wave timer up top. Reads challengeStore; portals to document.body so it sits over everything.
// (Phase 1. The light-blue points counter by the #6 quick-slot is Phase 2.)
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getChallengeState, subscribeChallenge } from './challengeStore';

const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

export function ChallengeHUD() {
  const st = useSyncExternalStore(subscribeChallenge, getChallengeState, getChallengeState);
  const [, force] = useState(0);

  useEffect(() => {
    if (!st.active && !st.announce) return;
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [st.active, st.announce]);

  const now = performance.now();
  const ann = st.announce && now < st.announce.until ? st.announce : null;
  const showTimer = st.active && st.waveEndsAt > 0;
  const remaining = showTimer ? Math.max(0, (st.waveEndsAt - now) / 1000) : 0;
  if (!ann && !showTimer) return null;

  const annOpacity = ann ? (ann.faint ? 0.5 : 1) * (ann.until - now < 500 ? (ann.until - now) / 500 : 1) : 0;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60, fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      {showTimer && (
        <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: 1, textShadow: '0 2px 6px #000' }}>
            Wave {st.wave}/{st.totalWaves}
          </div>
          <div style={{ color: '#ff4040', fontSize: 30, fontWeight: 800, textShadow: '0 2px 8px #000' }}>{fmt(remaining)}</div>
        </div>
      )}
      {ann && (
        <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', opacity: annOpacity, transition: 'opacity 0.15s' }}>
          <div style={{ color: '#fff', fontSize: 64, fontWeight: 900, letterSpacing: 2, textShadow: '0 4px 18px #000' }}>{ann.title}</div>
          {ann.subtitle && <div style={{ color: '#ffd76a', fontSize: 34, fontWeight: 700, marginTop: 6, textShadow: '0 2px 8px #000' }}>{ann.subtitle}</div>}
          {ann.image && <img src={ann.image} alt="" style={{ maxWidth: 360, maxHeight: 200, marginTop: 12, borderRadius: 8, boxShadow: '0 6px 24px #000' }} />}
          {ann.text && <div style={{ color: '#cfe3ff', fontSize: 20, marginTop: 10, textShadow: '0 2px 6px #000' }}>{ann.text}</div>}
        </div>
      )}
    </div>,
    document.body,
  );
}
