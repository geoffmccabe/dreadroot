// ChallengeResultPanel — the post-challenge screen (win or lose). Reads challengeStore.result (set
// by ChallengeRunner on finish/death) and lets the player retry the same challenge, pick another
// from the Browser, or close to free-roam. Completes the play loop so a finished challenge doesn't
// strand the player in the empty arena. DOM portal; mounted in the Fortress shell.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getChallengeState, subscribeChallenge, setChallengeState } from './challengeStore';
import { fireChallengeStart, fireChallengeExit } from './challengeControl';
import { setBrowserOpen } from './challengeBrowserStore';
import { challengeResultBoard, type LeaderboardEntry } from './challengeStorage';

const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const btn = (kind: 'go' | 'alt' | 'plain'): React.CSSProperties => ({
  background: kind === 'go' ? '#2e8b57' : kind === 'alt' ? '#3a6ea8' : 'hsla(220,25%,22%,0.9)',
  border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 7, color: '#e8eefb',
  padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
});

export function ChallengeResultPanel() {
  const st = useSyncExternalStore(subscribeChallenge, getChallengeState, getChallengeState);
  const res = st.result;
  const [board, setBoard] = useState<{ top: LeaderboardEntry[]; rank: number; plays: number } | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);   // the wheel-scrollable leaderboard list
  const youRef = useRef<HTMLDivElement>(null);       // the player's own row (gold)

  // Free the cursor so the buttons are clickable (the game holds pointer-lock during play).
  useEffect(() => { if (res) document.exitPointerLock?.(); }, [res]);

  // Fetch this run's rank + the top-5. Saved challenges only (need an id). A short delay lets the
  // just-finished run commit so it shows in the top-5 / play count (rank is correct either way).
  useEffect(() => {
    setBoard(null);
    const id = res?.challenge.id;
    if (!id || !res) return;
    setLoadingBoard(true);
    let cancelled = false;
    const t = setTimeout(() => {
      challengeResultBoard(id, res.score).then((b) => { if (!cancelled) { setBoard(b); setLoadingBoard(false); } })
        .catch(() => { if (!cancelled) setLoadingBoard(false); });
    }, 800);
    return () => { cancelled = true; clearTimeout(t); };
  }, [res]);

  // Show the top of the board first, then glide down to the player's own row so they see where they
  // landed relative to everyone else. Manual scrollTo (not scrollIntoView) so it never scrolls the page.
  useEffect(() => {
    const el = scrollRef.current; if (!board || !el) return;
    el.scrollTop = 0;
    const you = youRef.current; if (!you) return;
    const t = setTimeout(() => {
      el.scrollTo({ top: Math.max(0, you.offsetTop - el.clientHeight / 2 + you.clientHeight / 2), behavior: 'smooth' });
    }, 800);
    return () => clearTimeout(t);
  }, [board]);

  if (!res) return null;
  const win = res.outcome === 'win';
  // Play Again just dismisses the panel — fireChallengeStart revives + teleports into the new run.
  const dismiss = () => setChallengeState({ result: null });
  const playAgain = () => { const ch = res.challenge; dismiss(); fireChallengeStart(ch); };
  // Close / Choose Another LEAVE the challenge: a lost player is a ghost, so revive them to free-roam
  // (clears the wandering monsters + returns them to where they were before the challenge).
  const close = () => fireChallengeExit();
  const browse = () => { fireChallengeExit(); setBrowserOpen(true); };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 124, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}>
      {/* Hide the leaderboard's scrollbar (still wheel-scrollable). */}
      <style>{`.lb-scroll{scrollbar-width:none;-ms-overflow-style:none;} .lb-scroll::-webkit-scrollbar{width:0;height:0;display:none;}`}</style>
      <div style={{ width: 360, background: 'hsla(222, 32%, 10%, 0.97)', border: `1px solid ${win ? 'hsla(140,50%,55%,0.5)' : 'hsla(0,55%,55%,0.5)'}`, borderRadius: 14, boxShadow: '0 14px 60px #000', color: '#e8eefb', overflow: 'hidden', textAlign: 'center' }}>
        {/* Challenge banner as a full-width header, flush to the top edge (no gap). */}
        {res.challenge.banner && <img src={res.challenge.banner} alt="" style={{ width: '100%', aspectRatio: '4 / 1', objectFit: 'cover', display: 'block' }} />}
        <div style={{ padding: 24, paddingTop: res.challenge.banner ? 16 : 24 }}>
        <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 1, color: win ? '#8fe6a0' : '#ff9b9b' }}>{win ? 'VICTORY!' : 'DEFEATED'}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#cfe3ff', marginTop: 4 }}>{res.name}</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 16 }}>
          <div><div style={{ fontSize: 11, color: '#9fb4d0', fontWeight: 600 }}>SCORE</div><div style={{ fontSize: 22, fontWeight: 900, color: '#ffd27f' }}>{res.score.toLocaleString()}</div></div>
          <div><div style={{ fontSize: 11, color: '#9fb4d0', fontWeight: 600 }}>WAVE</div><div style={{ fontSize: 22, fontWeight: 900 }}>{res.wave}/{res.totalWaves}</div></div>
          <div><div style={{ fontSize: 11, color: '#9fb4d0', fontWeight: 600 }}>TIME</div><div style={{ fontSize: 22, fontWeight: 900 }}>{fmtTime(res.timeMs)}</div></div>
        </div>
        {/* Leaderboard: this run's rank + the board (saved challenges only). Shows the top, then
            auto-scrolls to the player's own row (gold). Wheel-scrollable; scrollbar hidden via CSS. */}
        {res.challenge.id && (
          <div style={{ marginTop: 18, padding: '10px 12px', background: 'hsla(220,25%,9%,0.6)', borderRadius: 8, textAlign: 'left' }}>
            {!board ? (
              <div style={{ fontSize: 12, color: '#9fb4d0', textAlign: 'center' }}>{loadingBoard ? 'Loading leaderboard…' : ''}</div>
            ) : (() => {
              const youIndex = board.rank - 1;   // the player's row in the descending board
              const lbRow = (key: React.Key, rank: number, name: string, completed: boolean, wave: number | null, score: number, gold: boolean, ref?: React.Ref<HTMLDivElement>) => (
                <div key={key} ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 6px', borderRadius: 5,
                  color: gold ? '#ffd27f' : '#c9d6ec', fontWeight: gold ? 800 : 400, background: gold ? 'hsla(43,80%,55%,0.16)' : 'transparent' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rank}. {name}{completed ? ' ✓' : ''}</span>
                  <span style={{ width: 56, textAlign: 'right', color: gold ? '#e8c97a' : '#9fb4d0' }}>{wave != null ? `Lvl ${wave}` : '—'}</span>
                  <span style={{ width: 72, textAlign: 'right', fontWeight: 700 }}>{score.toLocaleString()}</span>
                </div>
              );
              return (
                <>
                  <div style={{ textAlign: 'center', fontSize: 13, color: '#ffd27f', fontWeight: 800, marginBottom: 8 }}>
                    You placed {ord(board.rank)}{board.plays ? ` of ${board.plays}` : ''}
                  </div>
                  <div ref={scrollRef} className="lb-scroll" style={{ position: 'relative', maxHeight: 104, overflowY: 'auto' }}>
                    {board.top.map((e, i) => lbRow(i, i + 1, e.player_name ?? 'anon', e.completed, e.wave_reached, e.score, i === youIndex, i === youIndex ? youRef : undefined))}
                    {youIndex >= board.top.length && (
                      <>
                        <div style={{ textAlign: 'center', color: '#5e7494', fontSize: 12, lineHeight: 1 }}>⋯</div>
                        {lbRow('you', board.rank, 'You', false, res.wave, res.score, true, youRef)}
                      </>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 9, marginTop: 18 }}>
          <button style={{ ...btn('go'), flex: 1, minHeight: 48, padding: '7px 6px', lineHeight: 1.15, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={playAgain}>Play Again</button>
          <button style={{ ...btn('alt'), flex: 1, minHeight: 48, padding: '7px 6px', lineHeight: 1.15, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={browse}>Choose Another</button>
          <button style={{ ...btn('plain'), flex: 1, minHeight: 48, padding: '7px 6px', lineHeight: 1.15, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={close}>Close</button>
        </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
