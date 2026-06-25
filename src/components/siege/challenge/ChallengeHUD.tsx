// ChallengeHUD — the DOM overlay for a running challenge: the pre-game 10s countdown (with a
// START NOW button) and a SMALL top-of-screen wave banner on each wave change (kept tiny so it
// never washes out the view — the persistent "Wave X/10" counter shows the live number). Reads
// challengeStore; portals to document.body.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getChallengeState, subscribeChallenge } from './challengeStore';
import { fireChallengeSkip } from './challengeControl';

export function ChallengeHUD() {
  const st = useSyncExternalStore(subscribeChallenge, getChallengeState, getChallengeState);
  const [, force] = useState(0);

  const counting = st.countdownUntil > 0;
  useEffect(() => {
    if (!st.active && !st.announce && !counting) return;
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [st.active, st.announce, counting]);

  const now = performance.now();

  // ── Pre-game countdown ──
  if (st.countdownUntil > now) {
    const secs = Math.ceil((st.countdownUntil - now) / 1000);
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
        <div style={{ color: '#cfe3ff', fontSize: 'min(4vw, 30px)', fontWeight: 700, letterSpacing: 2, textShadow: '0 2px 10px #000' }}>GET READY</div>
        <div style={{ color: '#fff', fontSize: 'min(20vw, 180px)', fontWeight: 900, lineHeight: 1, textShadow: '0 4px 24px #000, 0 0 50px rgba(120,60,255,0.6)' }}>{secs}</div>
        <div style={{ color: '#9fb4d0', fontSize: 'min(2.6vw, 16px)', marginTop: 4, textShadow: '0 2px 8px #000' }}>Ready your weapons…</div>
        <button onClick={() => fireChallengeSkip()} style={{
          marginTop: 22, pointerEvents: 'auto', cursor: 'pointer',
          background: '#2e8b57', border: '1px solid hsla(210,30%,50%,0.5)', borderRadius: 8,
          color: '#eaffea', padding: '11px 26px', fontSize: 16, fontWeight: 800, letterSpacing: 1,
          boxShadow: '0 6px 22px #000', fontFamily: 'inherit',
        }}>START NOW</button>
      </div>,
      document.body,
    );
  }

  // ── Wave-change banner (small, top, brief) ──
  const ann = st.announce && now < st.announce.until ? st.announce : null;
  if (!ann) return null;
  const annOpacity = (ann.faint ? 0.6 : 1) * (ann.until - now < 500 ? (ann.until - now) / 500 : 1);
  return createPortal(
    <div style={{ position: 'fixed', top: '11%', left: 0, right: 0, pointerEvents: 'none', zIndex: 60, textAlign: 'center', opacity: annOpacity, transition: 'opacity 0.15s', fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      <div style={{ color: '#fff', fontSize: 'min(6vw, 52px)', fontWeight: 900, letterSpacing: 2, lineHeight: 1, textShadow: '0 3px 14px #000, 0 0 24px #000' }}>{ann.title}</div>
      {ann.subtitle && <div style={{ color: '#ffd76a', fontSize: 'min(3.4vw, 28px)', fontWeight: 800, marginTop: 4, textShadow: '0 2px 10px #000' }}>{ann.subtitle}</div>}
      {ann.text && <div style={{ color: '#cfe3ff', fontSize: 'min(2.4vw, 18px)', marginTop: 4, textShadow: '0 2px 8px #000' }}>{ann.text}</div>}
    </div>,
    document.body,
  );
}
