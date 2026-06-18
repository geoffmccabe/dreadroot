// ChallengeCreatorPanel — the full-screen (95%) authoring panel. Open with "!e". Edits a Challenge
// in memory and "Run" plays it in the live runner. All waves are stacked as rows (big #+name, info
// panel on the left, a horizontally drag-scrollable strip of spawn panels on the right); the top
// nav buttons scroll the stack to a wave. Persistence/leaderboards/banner/mini-map = later phases.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { isCreatorOpen, subscribeCreator, setCreatorOpen } from './challengeCreatorStore';
import { fireChallengeStart } from './challengeControl';
import { TEST_CHALLENGE } from './testChallenge';
import { MONSTER_CATALOG } from '../siegeMonsterCatalog';
import { playSound } from '@/lib/spatialAudio';
import type { Challenge, ChallengeWave, MonsterDrop, BossMods } from './challengeTypes';

// Same Kinetik-style glow ring the user/admin panels use (--panel-glow), for the lifted drag card.
const DRAG_GLOW = '0 0 0 2px hsl(var(--panel-glow) / 0.85), 0 0 28px 6px hsl(var(--panel-glow) / 0.5), 0 16px 40px -8px rgb(0 0 0 / 0.6)';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const reorder = <T,>(a: T[], from: number, to: number): T[] => { const r = [...a]; const [m] = r.splice(from, 1); r.splice(to, 0, m); return r; };
const cat = (type: number) => MONSTER_CATALOG.find((m) => m.id === type) ?? MONSTER_CATALOG[0];
const fmtMS = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const DEFAULT_BOSS: BossMods = { sizePct: 100, speedPct: 100, healthPct: 100, damagePct: 100 };

// HUD-themed styles.
const PANEL_BG = 'hsla(222, 32%, 10%, 0.96)';
const card: React.CSSProperties = { background: 'hsla(220, 28%, 16%, 0.8)', border: '1px solid hsla(210, 30%, 45%, 0.35)', borderRadius: 8, padding: 10 };
const lbl: React.CSSProperties = { fontSize: 11, color: '#9fb4d0', fontWeight: 600, display: 'block', marginBottom: 3 };
const inp: React.CSSProperties = { width: '100%', background: 'hsla(220,25%,8%,0.9)', border: '1px solid hsla(210,30%,45%,0.4)', borderRadius: 5, color: '#e8eefb', padding: '5px 7px', fontSize: 13, fontFamily: 'inherit' };
const btn = (active = false): React.CSSProperties => ({ background: active ? '#3a6ea8' : 'hsla(220,25%,22%,0.9)', border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 6, color: '#e8eefb', padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });

// A horizontally scrollable strip you can grab-and-drag (except on form controls) to pan.
function DragStrip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (drag.current.active && ref.current) ref.current.scrollLeft = drag.current.startScroll - (e.clientX - drag.current.startX); };
    const onUp = () => { drag.current.active = false; if (ref.current) ref.current.style.cursor = 'grab'; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  const onDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea, button')) return;   // let controls work
    drag.current = { active: true, startX: e.clientX, startScroll: ref.current!.scrollLeft };
    ref.current!.style.cursor = 'grabbing';
    e.preventDefault();
  };
  return <div ref={ref} className="chal-scroll" onMouseDown={onDown} style={{ overflowX: 'auto', display: 'flex', gap: 10, paddingBottom: 8, cursor: 'grab' }}>{children}</div>;
}

// A number input that lets you type freely — local string buffer so it never forces a sticky 0,
// you can clear it, and the model only syncs back in when the field isn't focused. Normalizes on
// blur (clamps `min`, applies the empty value).
function NumField({ value, onChange, min, allowEmpty, placeholder, style }: {
  value: number | undefined; onChange: (n: number | undefined) => void;
  min?: number; allowEmpty?: boolean; placeholder?: string; style?: React.CSSProperties;
}) {
  const [txt, setTxt] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTxt(value == null ? '' : String(value)); }, [value]);
  const commit = () => {
    if (txt.trim() === '') { onChange(allowEmpty ? undefined : (min ?? 0)); setTxt(allowEmpty ? '' : String(min ?? 0)); return; }
    let n = Number(txt); if (Number.isNaN(n)) n = min ?? 0; if (min != null && n < min) n = min;
    onChange(n); setTxt(String(n));
  };
  return (
    <input className="chal-num" type="number" min={min} placeholder={placeholder} style={style} value={txt}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; commit(); }}
      onChange={(e) => {
        const t = e.target.value; setTxt(t);
        if (t.trim() === '') { if (allowEmpty) onChange(undefined); return; }
        const n = Number(t); if (!Number.isNaN(n)) onChange(n);
      }} />
  );
}

export function ChallengeCreatorPanel() {
  const open = useSyncExternalStore(subscribeCreator, isCreatorOpen, isCreatorOpen);
  const [ch, setCh] = useState<Challenge>(() => clone(TEST_CHALLENGE));
  const waveEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const [dropHover, setDropHover] = useState<{ wave: number; drop: number } | null>(null);
  const [drag, setDrag] = useState<null | { wave: number; from: number; w: number; ox: number; oy: number }>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const dragHover = useRef<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ wave: number; drop: number } | null>(null);

  useEffect(() => {
    if (open) document.exitPointerLock?.();                       // free the cursor while editing
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isCreatorOpen()) { e.stopPropagation(); setCreatorOpen(false); } };
    if (open) window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // Pointer-drag reorder: while dragging a spawn header, a glowing card follows the cursor and the
  // hovered spawn highlights as the drop target; drop plays a thud. (drag is stable for the drag.)
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-spawn]');
      if (el && Number(el.getAttribute('data-wave')) === drag.wave) {
        const t = Number(el.getAttribute('data-spawn'));
        if (t !== dragHover.current) { dragHover.current = t; setDropHover({ wave: drag.wave, drop: t }); }
      }
    };
    const onUp = () => {
      const t = dragHover.current;
      if (t !== null && t !== drag.from) {
        setCh((c) => ({ ...c, waves: c.waves.map((w, k) => (k !== drag.wave ? w : { ...w, drops: reorder(w.drops, drag.from, t) })) }));
        void playSound('/wooden_thud_sound.mp3', 0.55);
      }
      dragHover.current = null; setDrag(null); setDropHover(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag]);

  if (!open) return null;

  // ── immutable updaters (all read FRESH state in the setter, so rapid edits never collide) ──
  const mapWave = (c: Challenge, i: number, fn: (w: ChallengeWave) => ChallengeWave): Challenge => ({ ...c, waves: c.waves.map((w, k) => (k === i ? fn(w) : w)) });
  const patch = (p: Partial<Challenge>) => setCh((c) => ({ ...c, ...p }));
  const patchWave = (i: number, p: Partial<ChallengeWave>) => setCh((c) => mapWave(c, i, (w) => ({ ...w, ...p })));
  const patchDrop = (i: number, di: number, p: Partial<MonsterDrop>) => setCh((c) => mapWave(c, i, (w) => ({ ...w, drops: w.drops.map((d, j) => (j === di ? { ...d, ...p } : d)) })));
  const patchBoss = (i: number, di: number, p: Partial<BossMods>) => setCh((c) => mapWave(c, i, (w) => ({ ...w, drops: w.drops.map((d, j) => (j === di ? { ...d, boss: { ...(d.boss ?? DEFAULT_BOSS), ...p } } : d)) })));
  const addWave = () => setCh((c) => ({ ...c, waves: [...c.waves, { name: `Wave ${c.waves.length + 1}`, timeSec: 60, drops: [] }] }));
  const removeWave = (i: number) => setCh((c) => ({ ...c, waves: c.waves.filter((_, k) => k !== i) }));
  const addDrop = (i: number) => setCh((c) => mapWave(c, i, (w) => ({ ...w, drops: [...w.drops, { type: 1, count: 1, x: c.spawn?.[0] ?? 0, z: c.spawn?.[2] ?? 0 }] })));
  const removeDrop = (i: number, di: number) => setCh((c) => mapWave(c, i, (w) => ({ ...w, drops: w.drops.filter((_, j) => j !== di) })));

  const run = () => { setCreatorOpen(false); fireChallengeStart(clone(ch)); };
  const scrollToWave = (i: number) => waveEls.current.get(i)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const slider = (i: number, di: number, key: keyof BossMods, label: string, drop: MonsterDrop, min: number, max: number, fmt: (pct: number) => string) => {
    const pct = drop.boss![key];
    return (
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cfe0f6' }}>
          <span>{label}</span><span style={{ color: '#7fd0ff', fontWeight: 700 }}>{fmt(pct)}</span>
        </div>
        <input type="range" className="chal-slider" min={min} max={max} step={5} value={pct} style={{ width: '100%' }}
               onChange={(e) => patchBoss(i, di, { [key]: Number(e.target.value) } as Partial<BossMods>)} />
      </div>
    );
  };

  // The full spawn card body — shared by the live card AND the floating drag preview, so the
  // dragged thing IS the real card (every field), not a summary chip. Grabbing the header captures
  // where in the card the cursor is (ox,oy) so the card tracks the cursor 1:1 with no recenter.
  const spawnInner = (drop: MonsterDrop, i: number, di: number, startAt: number) => {
    const c = cat(drop.type);
    return (
      <>
        <div onMouseDown={(e) => {
               if (e.button !== 0) return;
               e.stopPropagation(); e.preventDefault();
               const cardEl = (e.currentTarget as HTMLElement).closest('[data-spawn]') as HTMLElement | null;
               const rect = cardEl?.getBoundingClientRect();
               dragHover.current = di;
               setDrag({ wave: i, from: di, w: rect?.width ?? 220, ox: rect ? e.clientX - rect.left : 110, oy: rect ? e.clientY - rect.top : 16 });
               setDragPos({ x: e.clientX, y: e.clientY });
             }}
             style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, cursor: 'grab', userSelect: 'none' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#9fb4d0' }}><span style={{ color: '#5e7494' }}>⠿</span> Spawn {di + 1} <span style={{ color: '#7fd0ff' }}>@ {fmtMS(startAt)}</span></span>
          <button style={{ ...btn(), padding: '1px 7px', fontSize: 11 }} onMouseDown={(e) => e.stopPropagation()} onClick={() => setConfirmDel({ wave: i, drop: di })}>✕</button>
        </div>
        <label style={lbl}>Monster</label>
        <select style={inp} value={drop.type} onChange={(e) => patchDrop(i, di, { type: Number(e.target.value) })}>
          {MONSTER_CATALOG.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label style={{ ...lbl, marginTop: 6 }}>Seconds since last spawn</label>
        <NumField style={inp} value={drop.afterSec || undefined} min={0} allowEmpty placeholder="0" onChange={(n) => patchDrop(i, di, { afterSec: n ?? 0 })} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Count</label><NumField style={inp} value={drop.count} min={1} onChange={(n) => patchDrop(i, di, { count: n ?? 1 })} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Height (blank=rise)</label><NumField style={inp} value={drop.dropHeight} allowEmpty placeholder="rise" onChange={(n) => patchDrop(i, di, { dropHeight: n })} /></div>
        </div>
        {drop.count > 1 && (
          <div style={{ marginTop: 6 }}><label style={lbl}>Stagger: one every {drop.staggerMs ? (drop.staggerMs / 1000) : 0}s (0 = together)</label>
            <NumField style={inp} value={drop.staggerMs ? drop.staggerMs / 1000 : undefined} min={0} allowEmpty placeholder="0" onChange={(n) => patchDrop(i, di, { staggerMs: n ? n * 1000 : undefined })} /></div>
        )}
        <div style={{ marginTop: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!drop.boss} onChange={(e) => patchDrop(i, di, { boss: e.target.checked ? clone(DEFAULT_BOSS) : undefined })} /> Boss modifiers
          </label>
        </div>
        {drop.boss && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid hsla(210,30%,45%,0.25)' }}>
            {slider(i, di, 'sizePct', 'Size', drop, 25, 300, (p) => `${c.baseHeight.toFixed(1)}m → ${(c.baseHeight * p / 100).toFixed(1)}m`)}
            {slider(i, di, 'healthPct', 'Health', drop, 25, 500, (p) => `${c.baseHealth} → ${Math.round(c.baseHealth * p / 100)} HP`)}
            {slider(i, di, 'speedPct', 'Speed', drop, 25, 300, (p) => `100% → ${p}%`)}
            {slider(i, di, 'damagePct', 'Damage', drop, 25, 500, (p) => `100% → ${p}%`)}
          </div>
        )}
      </>
    );
  };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      <style>{`
        input[type=range].chal-slider { -webkit-appearance:none; appearance:none; height:6px; border-radius:3px; background:hsla(220,25%,8%,0.95); border:1px solid hsla(210,30%,45%,0.5); outline:none; }
        input[type=range].chal-slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:14px; height:14px; border-radius:50%; background:#5cc8ff; cursor:pointer; }
        input[type=range].chal-slider::-moz-range-thumb { width:14px; height:14px; border:none; border-radius:50%; background:#5cc8ff; cursor:pointer; }
        input[type=range].chal-slider::-moz-range-track { height:6px; border-radius:3px; background:hsla(220,25%,8%,0.95); }
        .chal-scroll { scrollbar-color: hsla(210,30%,45%,0.7) hsla(220,25%,10%,0.5); scrollbar-width: thin; }
        .chal-scroll::-webkit-scrollbar { width:10px; height:10px; }
        .chal-scroll::-webkit-scrollbar-track { background:hsla(220,25%,8%,0.5); }
        .chal-scroll::-webkit-scrollbar-thumb { background:hsla(210,30%,42%,0.8); border-radius:5px; }
        .chal-scroll::-webkit-scrollbar-thumb:hover { background:hsla(210,35%,52%,0.9); }
        input[type=number].chal-num::-webkit-inner-spin-button, input[type=number].chal-num::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
        input[type=number].chal-num { -moz-appearance:textfield; appearance:textfield; }
      `}</style>
      <div style={{ width: '95vw', height: '95vh', background: PANEL_BG, border: '1px solid hsla(210,40%,55%,0.4)', borderRadius: 12, boxShadow: '0 12px 60px #000', display: 'flex', flexDirection: 'column', color: '#e8eefb', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid hsla(210,30%,40%,0.3)' }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 1 }}>Challenge Creator</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn()} onClick={() => setCh(clone(TEST_CHALLENGE))}>Reset</button>
            <button style={{ ...btn(true), background: '#2e8b57' }} onClick={run}>▶ Run Challenge</button>
            <button style={btn()} onClick={() => setCreatorOpen(false)}>✕ Close</button>
          </div>
        </div>

        {/* General info */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 16px', borderBottom: '1px solid hsla(210,30%,40%,0.2)' }}>
          <div style={{ flex: 2 }}><label style={lbl}>Challenge Name</label><input style={inp} value={ch.name} onChange={(e) => patch({ name: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Creator</label><input style={inp} value={ch.creator} onChange={(e) => patch({ creator: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Divi Reward (to beat)</label><NumField style={inp} value={ch.rewardDivi || undefined} allowEmpty placeholder="0" onChange={(n) => patch({ rewardDivi: n ?? 0 })} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Banner (4×1)</label><div style={{ ...inp, color: '#7e90ad', fontSize: 11 }}>upload — coming soon</div></div>
        </div>

        {/* Wave nav — click to scroll the stack to that wave */}
        <div style={{ display: 'flex', gap: 5, padding: '8px 16px', flexWrap: 'wrap', borderBottom: '1px solid hsla(210,30%,40%,0.2)' }}>
          {ch.waves.map((w, i) => (
            <button key={i} style={{ ...btn(), padding: '4px 10px', fontSize: 12 }} onClick={() => scrollToWave(i)}>#{i + 1} {w.name || '—'}</button>
          ))}
          <button style={{ ...btn(true), padding: '4px 10px', fontSize: 12 }} onClick={addWave}>＋ Add Wave</button>
        </div>

        {/* Stacked waves */}
        <div className="chal-scroll" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {ch.waves.map((wave, i) => (
            <div key={i} ref={(el) => { if (el) waveEls.current.set(i, el); else waveEls.current.delete(i); }}
                 style={{ marginBottom: 22, paddingBottom: 16, borderBottom: '1px solid hsla(210,25%,35%,0.25)' }}>
              {/* Big #N + name */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 30, fontWeight: 900, color: '#7fd0ff' }}>#{i + 1}</span>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{wave.name || 'Unnamed wave'}</span>
                {ch.waves.length > 1 && <button style={{ ...btn(), padding: '2px 8px', fontSize: 11, marginLeft: 6 }} onClick={() => removeWave(i)}>Remove</button>}
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                {/* Left: wave info (always shown) */}
                <div style={{ ...card, width: 260, flexShrink: 0 }}>
                  <label style={lbl}>Wave Name</label><input style={inp} value={wave.name ?? ''} onChange={(e) => patchWave(i, { name: e.target.value })} />
                  <label style={{ ...lbl, marginTop: 8 }}>Wave Image URL</label><input style={inp} value={wave.image ?? ''} onChange={(e) => patchWave(i, { image: e.target.value })} />
                  <label style={{ ...lbl, marginTop: 8 }}>Wave Text</label><textarea style={{ ...inp, resize: 'vertical', minHeight: 44 }} value={wave.text ?? ''} onChange={(e) => patchWave(i, { text: e.target.value })} />
                  <label style={{ ...lbl, marginTop: 8 }}>Time: {fmtMS(wave.timeSec)}</label>
                  <input type="range" className="chal-slider" min={60} max={180} step={5} value={wave.timeSec} style={{ width: '100%' }} onChange={(e) => patchWave(i, { timeSec: Number(e.target.value) })} />
                  <label style={{ ...lbl, marginTop: 8 }}>Cost to Play (Divi)</label><NumField style={inp} value={wave.costDivi || undefined} allowEmpty placeholder="0" onChange={(n) => patchWave(i, { costDivi: n ?? 0 })} />
                  <label style={{ ...lbl, marginTop: 8 }}>% to Prize Pool</label><NumField style={inp} value={wave.pctToPool || undefined} allowEmpty placeholder="0" onChange={(n) => patchWave(i, { pctToPool: n ?? 0 })} />
                </div>

                {/* Right: spawn strip (drag to pan) */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>Monster Spawning</div>
                    <button style={{ ...btn(true), padding: '4px 10px', fontSize: 12 }} onClick={() => addDrop(i)}>＋ Add Spawn</button>
                    {(() => {
                      const total = wave.drops.reduce((a, d) => a + (d.afterSec ?? 0), 0);
                      return total > wave.timeSec
                        ? <span style={{ color: '#ff6b6b', fontSize: 12, fontWeight: 700 }}>⚠ last spawn {fmtMS(total)} — past the {fmtMS(wave.timeSec)} wave time</span>
                        : <span style={{ color: '#7e90ad', fontSize: 11 }}>last spawn @ {fmtMS(total)} / {fmtMS(wave.timeSec)} · drag to pan →</span>;
                    })()}
                  </div>
                  <DragStrip>
                    {(() => { let cum = 0; return wave.drops.map((drop, di) => {
                      cum += drop.afterSec ?? 0; const startAt = cum;
                      const isHover = dropHover?.wave === i && dropHover?.drop === di;
                      const isDragging = drag?.wave === i && drag?.from === di;
                      return (
                        <div key={di} data-wave={i} data-spawn={di}
                             style={{ ...card, width: 220, flexShrink: 0, transition: 'opacity 0.12s, border-color 0.12s',
                               ...(startAt > wave.timeSec ? { borderColor: '#ff6b6b' } : {}),
                               ...(isHover && !isDragging ? { borderColor: '#5cc8ff', boxShadow: '0 0 0 2px #5cc8ff inset' } : {}),
                               ...(isDragging ? { opacity: 0.25, borderStyle: 'dashed' } : {}) }}>
                          {spawnInner(drop, i, di, startAt)}
                        </div>
                      );
                    }); })()}
                  </DragStrip>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The real card, lifted: a full clone of the dragged spawn that tracks the cursor 1:1 (held
          at the exact point it was grabbed) with the panel glow behind it. No tilt — it reads as
          the actual card floating above the strip. pointer-events:none so drop-detection sees through. */}
      {drag && (() => {
        const dw = ch.waves[drag.wave]; const dd = dw?.drops[drag.from];
        if (!dd) return null;
        let s = 0; for (let k = 0; k <= drag.from; k++) s += dw.drops[k].afterSec ?? 0;
        return (
          <div style={{ position: 'fixed', left: dragPos.x - drag.ox, top: dragPos.y - drag.oy, width: drag.w, pointerEvents: 'none', zIndex: 200, ...card, boxShadow: DRAG_GLOW }}>
            {spawnInner(dd, drag.wave, drag.from, s)}
          </div>
        );
      })()}

      {/* Delete-spawn confirmation. */}
      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 20, minWidth: 280, textAlign: 'center', boxShadow: '0 14px 44px #000' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>Delete this spawn?</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button style={{ ...btn(), background: '#a83232' }} onClick={() => { removeDrop(confirmDel.wave, confirmDel.drop); setConfirmDel(null); }}>Delete</button>
              <button style={btn()} onClick={() => setConfirmDel(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
