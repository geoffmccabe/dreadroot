// ChallengeBrowser — the player-facing list of playable challenges for the ACTIVE game. Opened
// when a player picks "Challenge" at the start modal (or via "!b"). Shows a grid of challenge cards
// (banner, name, creator, cost/reward, a per-card leaderboard slot); "Play" starts that challenge
// through the same ChallengeRunner the test challenge uses. Challenges are game-scoped: this only
// ever lists challenges tagged with the game the player is currently in.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { isBrowserOpen, subscribeBrowser, setBrowserOpen } from './challengeBrowserStore';
import { listGameChallenges, listLeaderboards, type ChallengeRow, type Leaderboard } from './challengeStorage';
import { fireChallengeStart } from './challengeControl';
import { useActiveGame } from '@/config/activeGame';
import { getGameDef } from '@/config/gameRegistry';
import { SIEGE_TELEPORTS, SIEGE_DEMOS } from '../siegeAreas';
import { siegeJump } from '../teleportStore';

const PANEL_BG = 'hsla(222, 32%, 10%, 0.97)';
const card: React.CSSProperties = { background: 'hsla(220, 28%, 16%, 0.85)', border: '1px solid hsla(210, 30%, 45%, 0.35)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const btn = (active = false): React.CSSProperties => ({ background: active ? '#2e8b57' : 'hsla(220,25%,22%,0.9)', border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 6, color: '#e8eefb', padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });
const sectionTitle: React.CSSProperties = { fontSize: 18, fontWeight: 900, letterSpacing: 1, marginBottom: 10 };

// Worlds row — clickable teleport cards. Row 1 = the 5 open-world areas (slots 1-5);
// Row 2 = the two baked demo maps. Positions/maps come from siegeAreas.
const tpBySlot = (s: number) => SIEGE_TELEPORTS.find((t) => t.slot === s)!;
const demoByCode = (c: string) => SIEGE_DEMOS.find((d) => d.code === c)!;
const WORLD_ROW1 = [
  { label: 'LOBBY', t: tpBySlot(1), img: '/world_cards/lobby.webp', desc: 'Central hub — vendors, vault, forge, and portals to every world.' },
  { label: 'THE BEACH', t: tpBySlot(2), img: '/world_cards/beach.webp', desc: 'Sun-soaked shoreline at the open world’s edge.' },
  { label: 'BLEAKROCK', t: tpBySlot(3), img: '/world_cards/bleakrock.webp', desc: 'The volcanic Mushroom isle — your spawn and home base.' },
  { label: 'HAROLD', t: tpBySlot(4), img: '/world_cards/harold.webp', desc: 'A separate instance — seek out Harold.' },
  { label: "NERO'S ISLAND", t: tpBySlot(5), img: '/world_cards/nero.webp', desc: 'Nero’s remote island stronghold.' },
];
const WORLD_ROW2 = [
  { label: 'SCI-FI CITY', d: demoByCode('KeyA'), img: '/world_cards/scifi_city.webp', desc: 'A neon Synty sci-fi metropolis to explore.' },
  { label: 'ADVENTURE TOWN', d: demoByCode('KeyN'), img: '/world_cards/adventure_town.webp', desc: 'A cozy fantasy village, fully built to wander.' },
];

// Mirrors the challenge card: a 4:1 banner image + name + short description. The
// images live in public/world_cards/*.webp at their native ~1.88:1 ratio.
function WorldCard({ label, img, desc, onClick }: { label: string; img: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...card, cursor: 'pointer', padding: 0, textAlign: 'left', color: '#e8eefb', font: 'inherit', width: '100%' }}>
      <img src={img} alt="" style={{ width: '100%', aspectRatio: '1826 / 972', objectFit: 'cover', display: 'block' }} />
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#9fb4d0', lineHeight: 1.3 }}>{desc}</div>
      </div>
    </button>
  );
}

const totalMonsters = (r: ChallengeRow) =>
  (r.data?.waves ?? []).reduce((a, w) => a + (w.drops ?? []).reduce((b, d) => b + (d.count || 1), 0), 0);

export function ChallengeBrowser() {
  const open = useSyncExternalStore(subscribeBrowser, isBrowserOpen, isBrowserOpen);
  const [rows, setRows] = useState<ChallengeRow[]>([]);
  const [boards, setBoards] = useState<Record<string, Leaderboard>>({});
  const [loading, setLoading] = useState(false);
  const game = useActiveGame();
  const gameLabel = getGameDef(game).label;

  useEffect(() => {
    if (!open) return;
    document.exitPointerLock?.();
    setLoading(true);
    let cancelled = false;
    listGameChallenges(game).then(async (r) => {
      if (cancelled) return;
      setRows(r); setLoading(false);
      const lbs = await listLeaderboards(r.map((x) => x.id));
      if (!cancelled) setBoards(lbs);
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isBrowserOpen()) { e.stopPropagation(); setBrowserOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => { cancelled = true; window.removeEventListener('keydown', onKey, true); };
  }, [open, game]);

  if (!open) return null;

  const play = (r: ChallengeRow) => { setBrowserOpen(false); fireChallengeStart({ ...r.data, id: r.id }); };
  const goWorld = (mapId: string, pos: [number, number, number], yaw?: number, pitch?: number) => {
    setBrowserOpen(false);
    siegeJump(mapId, pos, yaw, pitch);
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 122, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}>
      <style>{`
        .chal-scroll { scrollbar-color: hsla(210,30%,45%,0.7) hsla(220,25%,10%,0.5); scrollbar-width: thin; }
        .chal-scroll::-webkit-scrollbar { width:10px; height:10px; }
        .chal-scroll::-webkit-scrollbar-track { background:hsla(220,25%,8%,0.5); }
        .chal-scroll::-webkit-scrollbar-thumb { background:hsla(210,30%,42%,0.8); border-radius:5px; }
        .chal-scroll::-webkit-scrollbar-thumb:hover { background:hsla(210,35%,52%,0.9); }
      `}</style>
      <div className="chal-scroll" style={{ width: '92vw', height: '90vh', background: PANEL_BG, border: '1px solid hsla(210,40%,55%,0.4)', borderRadius: 12, boxShadow: '0 12px 60px #000', display: 'flex', flexDirection: 'column', color: '#e8eefb', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid hsla(210,30%,40%,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1 }}>Worlds &amp; Challenges</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ffd27f' }}>{gameLabel}</div>
          </div>
          <button style={btn()} onClick={() => setBrowserOpen(false)}>✕ Close</button>
        </div>

        {/* Sections: Worlds (teleport) + Challenges */}
        <div className="chal-scroll" style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {/* ── Worlds ── 5 open-world areas on top, 2 demo maps below. Click to teleport. */}
          <div style={sectionTitle}>Worlds</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {WORLD_ROW1.map((w) => (
              <WorldCard key={w.label} label={w.label} img={w.img} desc={w.desc}
                onClick={() => goWorld(w.t.mapId ?? 'siege-test', w.t.pos, w.t.yaw, w.t.pitch)} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 12 }}>
            {WORLD_ROW2.map((w) => (
              <WorldCard key={w.label} label={w.label} img={w.img} desc={w.desc} onClick={() => goWorld(w.d.mapId, w.d.pos, w.d.yaw, w.d.pitch)} />
            ))}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid hsla(210,30%,40%,0.4)', margin: '18px 0' }} />

          {/* ── Challenges ── */}
          <div style={sectionTitle}>Challenges</div>
          {loading ? (
            <div style={{ color: '#9fb4d0', padding: 20 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: '#9fb4d0', padding: 20 }}>No challenges for {gameLabel} yet. Open the Creator (!e) to build one.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
              {rows.map((r) => (
                <div key={r.id} style={card}>
                  {/* Banner (4×1) or a name placeholder */}
                  {r.data?.banner ? (
                    <img src={r.data.banner} alt="" style={{ width: '100%', aspectRatio: '4 / 1', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '4 / 1', background: 'linear-gradient(135deg,#243049,#3a4a6b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9fb4d0', fontWeight: 800, fontSize: 15, padding: 6, textAlign: 'center' }}>{r.name}</div>
                  )}
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: '#7e90ad' }}>by {r.creator_name ?? '—'} · {(r.data?.waves?.length ?? 0)} waves · {totalMonsters(r)} monsters</div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                      <span style={{ color: '#ffcf6b' }}>Cost {r.data?.costDivi || 0} ◈</span>
                      <span style={{ color: '#8fe6a0' }}>Reward {r.data?.rewardDivi || 0} ◈</span>
                    </div>
                    {/* Per-card leaderboard — top scores from challenge_runs (Phase 7). */}
                    {(() => {
                      const lb = boards[r.id];
                      return (
                        <div style={{ marginTop: 2, padding: '6px 8px', background: 'hsla(220,25%,9%,0.6)', borderRadius: 6, fontSize: 11 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9fb4d0', fontWeight: 700, marginBottom: lb?.top.length ? 4 : 0 }}>
                            <span>🏆 Leaderboard</span>{lb?.plays ? <span>{lb.plays} {lb.plays === 1 ? 'play' : 'plays'}</span> : null}
                          </div>
                          {lb?.top.length ? lb.top.map((e, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, color: i === 0 ? '#ffd27f' : '#c9d6ec' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {e.player_name ?? 'anon'}{e.completed ? ' ✓' : ''}</span>
                              <span style={{ fontWeight: 700 }}>{e.score.toLocaleString()}</span>
                            </div>
                          )) : <span style={{ color: '#7e90ad' }}>No runs yet</span>}
                        </div>
                      );
                    })()}
                    <button style={{ ...btn(true), marginTop: 'auto' }} onClick={() => play(r)}>▶ Play</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
