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
  if (!ann) return null;

  const annOpacity = (ann.faint ? 0.5 : 1) * (ann.until - now < 500 ? (ann.until - now) / 500 : 1);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60, fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      <div style={{ position: 'absolute', top: '34%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', width: '100%', opacity: annOpacity, transition: 'opacity 0.15s' }}>
        <div style={{ color: '#fff', fontSize: 'min(13vw, 150px)', fontWeight: 900, letterSpacing: 3, lineHeight: 1, textShadow: '0 6px 28px #000, 0 0 40px rgba(0,0,0,0.8)' }}>{ann.title}</div>
        {ann.subtitle && <div style={{ color: '#ffd76a', fontSize: 'min(6vw, 60px)', fontWeight: 800, marginTop: 10, textShadow: '0 3px 12px #000' }}>{ann.subtitle}</div>}
        {ann.image && <img src={ann.image} alt="" style={{ maxWidth: 420, maxHeight: 240, marginTop: 14, borderRadius: 10, boxShadow: '0 6px 28px #000' }} />}
        {ann.text && <div style={{ color: '#cfe3ff', fontSize: 'min(3vw, 26px)', marginTop: 12, textShadow: '0 2px 8px #000' }}>{ann.text}</div>}
      </div>
    </div>,
    document.body,
  );
}
