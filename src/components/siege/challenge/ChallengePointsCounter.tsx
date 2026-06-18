// ChallengePointsCounter — the live wave/timer/points readout, placed to the RIGHT of the #6
// quick-slot and vertically centred with it (absolutely positioned inside the hotbar row, so it
// never shifts the bar). Large light-blue points, the red wave timer above them. Reads the
// challenge store for the timer and the score accumulator for the points (its own 100ms tick).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getChallengeState, subscribeChallenge } from './challengeStore';
import { getChallengeScore } from './challengeScore';

const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

export function ChallengePointsCounter() {
  const st = useSyncExternalStore(subscribeChallenge, getChallengeState, getChallengeState);
  const [, force] = useState(0);
  useEffect(() => {
    if (!st.active) return;
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [st.active]);

  if (!st.active) return null;
  const now = performance.now();
  const remaining = st.waveEndsAt > 0 ? Math.max(0, (st.waveEndsAt - now) / 1000) : 0;

  return (
    <div style={{ position: 'absolute', left: 'calc(100% + 18px)', top: '50%', transform: 'translateY(-50%)', textAlign: 'center', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
      <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: 1, textShadow: '0 2px 5px #000' }}>Wave {st.wave}/{st.totalWaves}</div>
      <div style={{ color: '#ff4040', fontSize: 24, fontWeight: 800, lineHeight: 1.1, textShadow: '0 2px 6px #000' }}>{fmt(remaining)}</div>
      <div style={{ color: '#5cc8ff', fontSize: 46, fontWeight: 900, lineHeight: 1, textShadow: '0 0 14px rgba(92,200,255,0.6), 0 2px 8px #000' }}>{Math.round(getChallengeScore())}</div>
    </div>
  );
}
