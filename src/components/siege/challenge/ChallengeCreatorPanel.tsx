// ChallengeCreatorPanel — the full-screen (95%) authoring panel. Open with "!e". Edits a Challenge
// in memory (variable waves, unlimited drops, boss sliders) and "Run" plays it in the live runner.
// Persistence, leaderboards, banner upload + mini-map are later phases (placeholders here).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { isCreatorOpen, subscribeCreator, setCreatorOpen } from './challengeCreatorStore';
import { fireChallengeStart } from './challengeControl';
import { TEST_CHALLENGE } from './testChallenge';
import { MONSTER_CATALOG } from '../siegeMonsterCatalog';
import type { Challenge, ChallengeWave, MonsterDrop, BossMods } from './challengeTypes';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const cat = (type: number) => MONSTER_CATALOG.find((m) => m.id === type) ?? MONSTER_CATALOG[0];
const DEFAULT_BOSS: BossMods = { sizePct: 100, speedPct: 100, healthPct: 100, damagePct: 100 };

// HUD-themed styles.
const PANEL_BG = 'hsla(222, 32%, 10%, 0.96)';
const card: React.CSSProperties = { background: 'hsla(220, 28%, 16%, 0.8)', border: '1px solid hsla(210, 30%, 45%, 0.35)', borderRadius: 8, padding: 10 };
const lbl: React.CSSProperties = { fontSize: 11, color: '#9fb4d0', fontWeight: 600, display: 'block', marginBottom: 3 };
const inp: React.CSSProperties = { width: '100%', background: 'hsla(220,25%,8%,0.9)', border: '1px solid hsla(210,30%,45%,0.4)', borderRadius: 5, color: '#e8eefb', padding: '5px 7px', fontSize: 13, fontFamily: 'inherit' };
const btn = (active = false): React.CSSProperties => ({ background: active ? '#3a6ea8' : 'hsla(220,25%,22%,0.9)', border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 6, color: '#e8eefb', padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });

export function ChallengeCreatorPanel() {
  const open = useSyncExternalStore(subscribeCreator, isCreatorOpen, isCreatorOpen);
  const [ch, setCh] = useState<Challenge>(() => clone(TEST_CHALLENGE));
  const [wi, setWi] = useState(0);

  useEffect(() => {
    if (open) document.exitPointerLock?.();                       // free the cursor while editing
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isCreatorOpen()) { e.stopPropagation(); setCreatorOpen(false); } };
    if (open) window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  const wave = ch.waves[Math.min(wi, ch.waves.length - 1)] as ChallengeWave | undefined;

  // ── immutable updaters (all read FRESH state in the setter, so rapid edits never collide) ──
  const mapWave = (c: Challenge, i: number, fn: (w: ChallengeWave) => ChallengeWave): Challenge => ({ ...c, waves: c.waves.map((w, k) => (k === i ? fn(w) : w)) });
  const patch = (p: Partial<Challenge>) => setCh((c) => ({ ...c, ...p }));
  const patchWave = (i: number, p: Partial<ChallengeWave>) => setCh((c) => mapWave(c, i, (w) => ({ ...w, ...p })));
  const patchDrop = (i: number, di: number, p: Partial<MonsterDrop>) => setCh((c) => mapWave(c, i, (w) => ({ ...w, drops: w.drops.map((d, j) => (j === di ? { ...d, ...p } : d)) })));
  const patchBoss = (i: number, di: number, p: Partial<BossMods>) => setCh((c) => mapWave(c, i, (w) => ({ ...w, drops: w.drops.map((d, j) => (j === di ? { ...d, boss: { ...(d.boss ?? DEFAULT_BOSS), ...p } } : d)) })));
  const addWave = () => { setWi(ch.waves.length); setCh((c) => ({ ...c, waves: [...c.waves, { name: `Wave ${c.waves.length + 1}`, timeSec: 60, drops: [] }] })); };
  const removeWave = (i: number) => { setWi((s) => Math.max(0, Math.min(s, ch.waves.length - 2))); setCh((c) => ({ ...c, waves: c.waves.filter((_, k) => k !== i) })); };
  const addDrop = (i: number) => setCh((c) => mapWave(c, i, (w) => ({ ...w, drops: [...w.drops, { type: 1, count: 1, x: c.spawn?.[0] ?? 0, z: c.spawn?.[2] ?? 0 }] })));
  const removeDrop = (i: number, di: number) => setCh((c) => mapWave(c, i, (w) => ({ ...w, drops: w.drops.filter((_, j) => j !== di) })));

  const run = () => { setCreatorOpen(false); fireChallengeStart(clone(ch)); };

  const slider = (key: keyof BossMods, label: string, drop: MonsterDrop, di: number, min: number, max: number, fmt: (pct: number) => string) => {
    const pct = drop.boss![key];
    return (
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cfe0f6' }}>
          <span>{label}</span><span style={{ color: '#7fd0ff', fontWeight: 700 }}>{fmt(pct)}</span>
        </div>
        <input type="range" min={min} max={max} step={5} value={pct} style={{ width: '100%' }}
               onChange={(e) => patchBoss(wi, di, { [key]: Number(e.target.value) } as Partial<BossMods>)} />
      </div>
    );
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      <div style={{ width: '95vw', height: '95vh', background: PANEL_BG, border: '1px solid hsla(210,40%,55%,0.4)', borderRadius: 12, boxShadow: '0 12px 60px #000', display: 'flex', flexDirection: 'column', color: '#e8eefb', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid hsla(210,30%,40%,0.3)' }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 1 }}>Challenge Creator</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn()} onClick={() => { setCh(clone(TEST_CHALLENGE)); setWi(0); }}>Reset</button>
            <button style={{ ...btn(true), background: '#2e8b57' }} onClick={run}>▶ Run Challenge</button>
            <button style={btn()} onClick={() => setCreatorOpen(false)}>✕ Close</button>
          </div>
        </div>

        {/* General info */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid hsla(210,30%,40%,0.2)' }}>
          <div style={{ flex: 2 }}><label style={lbl}>Challenge Name</label><input style={inp} value={ch.name} onChange={(e) => patch({ name: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Creator</label><input style={inp} value={ch.creator} onChange={(e) => patch({ creator: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Divi Reward (to beat)</label><input style={inp} type="number" value={ch.rewardDivi ?? 0} onChange={(e) => patch({ rewardDivi: Number(e.target.value) })} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Banner (4×1)</label><div style={{ ...inp, color: '#7e90ad', fontSize: 11 }}>upload — coming soon</div></div>
        </div>

        {/* Wave tabs */}
        <div style={{ display: 'flex', gap: 5, padding: '8px 16px', flexWrap: 'wrap', borderBottom: '1px solid hsla(210,30%,40%,0.2)' }}>
          {ch.waves.map((w, i) => (
            <button key={i} style={{ ...btn(i === wi), padding: '4px 10px', fontSize: 12 }} onClick={() => setWi(i)}>{i + 1}. {w.name || '—'}</button>
          ))}
          <button style={{ ...btn(), padding: '4px 10px', fontSize: 12 }} onClick={addWave}>＋ Add Wave</button>
        </div>

        {/* Selected wave */}
        {wave && (
          <div style={{ display: 'flex', gap: 12, padding: 16, flex: 1, overflow: 'hidden' }}>
            {/* Left: wave fields */}
            <div style={{ ...card, width: 260, flexShrink: 0, overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Wave {wi + 1}</div>
                {ch.waves.length > 1 && <button style={{ ...btn(), padding: '2px 8px', fontSize: 11 }} onClick={() => removeWave(wi)}>Remove</button>}
              </div>
              <label style={lbl}>Wave Name</label><input style={inp} value={wave.name ?? ''} onChange={(e) => patchWave(wi, { name: e.target.value })} />
              <label style={{ ...lbl, marginTop: 8 }}>Wave Image URL</label><input style={inp} value={wave.image ?? ''} onChange={(e) => patchWave(wi, { image: e.target.value })} />
              <label style={{ ...lbl, marginTop: 8 }}>Wave Text</label><textarea style={{ ...inp, resize: 'vertical', minHeight: 44 }} value={wave.text ?? ''} onChange={(e) => patchWave(wi, { text: e.target.value })} />
              <label style={{ ...lbl, marginTop: 8 }}>Time: {(wave.timeSec / 60).toFixed(2)} min</label>
              <input type="range" min={60} max={180} step={15} value={wave.timeSec} style={{ width: '100%' }} onChange={(e) => patchWave(wi, { timeSec: Number(e.target.value) })} />
              <label style={{ ...lbl, marginTop: 8 }}>Cost to Play (Divi)</label><input style={inp} type="number" value={wave.costDivi ?? 0} onChange={(e) => patchWave(wi, { costDivi: Number(e.target.value) })} />
              <label style={{ ...lbl, marginTop: 8 }}>% to Prize Pool</label><input style={inp} type="number" value={wave.pctToPool ?? 0} onChange={(e) => patchWave(wi, { pctToPool: Number(e.target.value) })} />
            </div>

            {/* Right: drops */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Monster Drops</div>
                <button style={{ ...btn(true), padding: '4px 10px', fontSize: 12 }} onClick={() => addDrop(wi)}>＋ Add Drop</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {wave.drops.map((drop, di) => {
                  const c = cat(drop.type);
                  return (
                    <div key={di} style={{ ...card, width: 230 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#9fb4d0' }}>Drop {di + 1}</span>
                        <button style={{ ...btn(), padding: '1px 7px', fontSize: 11 }} onClick={() => removeDrop(wi, di)}>✕</button>
                      </div>
                      <label style={lbl}>Monster</label>
                      <select style={inp} value={drop.type} onChange={(e) => patchDrop(wi, di, { type: Number(e.target.value) })}>
                        {MONSTER_CATALOG.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <div style={{ flex: 1 }}><label style={lbl}>Count</label><input style={inp} type="number" min={1} value={drop.count} onChange={(e) => patchDrop(wi, di, { count: Math.max(1, Number(e.target.value)) })} /></div>
                        <div style={{ flex: 1 }}><label style={lbl}>Height (blank=rise)</label><input style={inp} type="number" value={drop.dropHeight ?? ''} onChange={(e) => patchDrop(wi, di, { dropHeight: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
                      </div>
                      {drop.count > 1 && (
                        <div style={{ marginTop: 6 }}><label style={lbl}>Stagger: one every {drop.staggerMs ? (drop.staggerMs / 1000) : 0}s (0 = together)</label>
                          <input style={inp} type="number" min={0} value={drop.staggerMs ? drop.staggerMs / 1000 : 0} onChange={(e) => patchDrop(wi, di, { staggerMs: Number(e.target.value) > 0 ? Number(e.target.value) * 1000 : undefined })} /></div>
                      )}
                      <div style={{ marginTop: 6 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!drop.boss} onChange={(e) => patchDrop(wi, di, { boss: e.target.checked ? clone(DEFAULT_BOSS) : undefined })} /> Boss modifiers
                        </label>
                      </div>
                      {drop.boss && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid hsla(210,30%,45%,0.25)' }}>
                          {slider('sizePct', 'Size', drop, di, 25, 300, (p) => `${(c.baseHeight).toFixed(1)}m → ${(c.baseHeight * p / 100).toFixed(1)}m`)}
                          {slider('healthPct', 'Health', drop, di, 25, 500, (p) => `${c.baseHealth} → ${Math.round(c.baseHealth * p / 100)} HP`)}
                          {slider('speedPct', 'Speed', drop, di, 25, 300, (p) => `100% → ${p}%`)}
                          {slider('damagePct', 'Damage', drop, di, 25, 500, (p) => `100% → ${p}%`)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
