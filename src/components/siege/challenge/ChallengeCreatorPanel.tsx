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
import { MonsterThumb, MonsterPortCanvas, MonsterPreviewBox, defaultColor } from './MonsterPreview';
import { BLEND_MODES } from './colorMods';
import { BannerInput } from './BannerInput';
import { useAuth } from '@/contexts/AuthContext';
import { saveChallenge, listMyChallenges, listAllChallenges, deleteChallenge, fetchRoles, type ChallengeRow } from './challengeStorage';
import { SIEGE_TELEPORTS } from '../siegeAreas';
import { regionCoords } from './regionDefaults';
import { getActiveGame } from '@/config/activeGame';
import { GAME_LIST } from '@/config/gameRegistry';
import { playSound } from '@/lib/spatialAudio';
import type { Challenge, ChallengeWave, MonsterDrop, BossMods } from './challengeTypes';

const REGIONS = SIEGE_TELEPORTS.map((t) => t.name);   // Open-World regions for the superadmin spawner

// Same Kinetik-style glow ring the user/admin panels use (--panel-glow), for the lifted drag card.
const DRAG_GLOW = '0 0 0 2px hsl(var(--panel-glow) / 0.85), 0 0 28px 6px hsl(var(--panel-glow) / 0.5), 0 16px 40px -8px rgb(0 0 0 / 0.6)';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const reorder = <T,>(a: T[], from: number, to: number): T[] => { const r = [...a]; const [m] = r.splice(from, 1); r.splice(to, 0, m); return r; };
const cat = (type: number) => MONSTER_CATALOG.find((m) => m.id === type) ?? MONSTER_CATALOG[0];
const fmtMS = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const DEFAULT_BOSS: BossMods = { sizePct: 100, speedPct: 100, healthPct: 100, damagePct: 100 };

// HUD-themed styles.
const PANEL_BG = 'hsla(222, 32%, 10%, 0.96)';
// Opaque variant for the fixed top chrome (header / general-info / wave-nav). The shared thumbnail
// canvas (MonsterPortCanvas) renders at z90 over the whole panel; lifting the chrome above it with a
// SOLID bg makes cards that scroll up vanish UNDER the header instead of drawing on top of it.
const PANEL_SOLID = 'hsl(222, 32%, 10%)';
const CHROME: React.CSSProperties = { position: 'relative', zIndex: 95, background: PANEL_SOLID };
const card: React.CSSProperties = { background: 'hsla(220, 28%, 16%, 0.8)', border: '1px solid hsla(210, 30%, 45%, 0.35)', borderRadius: 8, padding: 10 };
const lbl: React.CSSProperties = { fontSize: 11, color: '#9fb4d0', fontWeight: 600, display: 'block', marginBottom: 3 };
const inp: React.CSSProperties = { width: '100%', background: 'hsla(220,25%,8%,0.9)', border: '1px solid hsla(210,30%,45%,0.4)', borderRadius: 5, color: '#e8eefb', padding: '5px 7px', fontSize: 13, fontFamily: 'inherit' };
const btn = (active = false): React.CSSProperties => ({ background: active ? '#3a6ea8' : 'hsla(220,25%,22%,0.9)', border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 6, color: '#e8eefb', padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });

// Where the big floating monster preview sits relative to a spawn card: centred above it (or below
// if there's no room), clamped to the viewport.
const BOX_W = 260, BOX_H = 260;
function boxPos(rect: DOMRect) {
  const x = Math.max(8, Math.min(rect.left + rect.width / 2 - BOX_W / 2, window.innerWidth - BOX_W - 8));
  let y = rect.top - BOX_H - 12;
  if (y < 8) y = Math.min(rect.bottom + 12, window.innerHeight - BOX_H - 8);
  return { x, y };
}

// Custom monster picker so HOVERING an option previews that monster live in BOTH the card thumbnail
// and the big floating box (native <select> options can't be hovered). Opening pins the big box to
// this card; hovering overrides the shown monster; clicking commits. List portalled to <body>.
function MonsterSelect({ value, onChange, onOpen, onClose, onHover }: {
  value: number; onChange: (t: number) => void;
  onOpen: (x: number, y: number) => void; onClose: () => void; onHover: (t: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const [lp, setLp] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); setHi(-1); onHover(null); onClose(); };
  const openIt = () => {
    const el = ref.current; if (!el) return;
    const br = el.getBoundingClientRect();
    setLp({ left: br.left, top: br.bottom + 4, width: br.width });
    const cardEl = el.closest('[data-spawn]') as HTMLElement | null;
    if (cardEl) { const p = boxPos(cardEl.getBoundingClientRect()); onOpen(p.x, p.y); }
    setOpen(true);
  };
  return (
    <>
      <button ref={ref} type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => (open ? close() : openIt())}
              style={{ ...inp, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{cat(value).name}</span><span style={{ color: '#7e90ad' }}>▾</span>
      </button>
      {open && lp && createPortal(
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 219 }} />
          <div onMouseLeave={() => { setHi(-1); onHover(null); }} className="chal-scroll"
               style={{ position: 'fixed', left: lp.left, top: lp.top, width: Math.max(lp.width, 180), maxHeight: 280, overflowY: 'auto', zIndex: 220, ...card, padding: 4 }}>
            {MONSTER_CATALOG.map((m, idx) => (
              <div key={m.id} onMouseEnter={() => { setHi(idx); onHover(m.id); }}
                   onClick={() => { onChange(m.id); close(); }}
                   style={{ padding: '6px 9px', borderRadius: 5, cursor: 'pointer', fontSize: 13, color: '#e8eefb',
                     background: hi === idx ? 'hsla(205,70%,45%,0.55)' : m.id === value ? 'hsla(210,40%,32%,0.6)' : 'transparent' }}>
                {m.name}
              </div>
            ))}
          </div>
        </>, document.body)}
    </>
  );
}

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
  const { user } = useAuth();
  const [ch, setCh] = useState<Challenge>(() => ({ ...clone(TEST_CHALLENGE), game: getActiveGame() }));
  const [roles, setRoles] = useState<string[]>([]);
  const [saveMsg, setSaveMsg] = useState('');
  const [picker, setPicker] = useState<null | { rows: ChallengeRow[]; loading: boolean }>(null);
  const isAdmin = roles.includes('admin') || roles.includes('superadmin');
  const isSuper = roles.includes('superadmin');
  const waveEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const [dropHover, setDropHover] = useState<{ wave: number; drop: number } | null>(null);
  const [drag, setDrag] = useState<null | { wave: number; from: number; w: number; ox: number; oy: number }>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const dragHover = useRef<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ wave: number; drop: number } | null>(null);
  const [preview, setPreview] = useState<{ wave: number; drop: number; x: number; y: number } | null>(null);  // card hover
  const [pinned, setPinned] = useState<{ wave: number; drop: number; x: number; y: number } | null>(null);    // dropdown open
  const [hoverType, setHoverType] = useState<number | null>(null);                                              // hovered option

  useEffect(() => {
    if (open) document.exitPointerLock?.();                       // free the cursor while editing
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isCreatorOpen()) { e.stopPropagation(); setCreatorOpen(false); } };
    if (open) window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // Load the signed-in user's roles when the panel opens (admins/superadmins get extra powers).
  useEffect(() => { if (open && user?.id) fetchRoles(user.id).then(setRoles); }, [open, user?.id]);

  // ── Save / load ──────────────────────────────────────────────────────────────────────────────
  // Snapshot of the last saved/loaded state; the Save button pulses whenever `ch` differs from it.
  const savedJson = useRef<string | null>(null);
  const markSaved = (c: Challenge) => { savedJson.current = JSON.stringify(c); };
  const newChallenge = () => {
    const fresh = clone(TEST_CHALLENGE); delete fresh.id;
    fresh.creator = user?.email?.split('@')[0] ?? fresh.creator;
    fresh.game = getActiveGame();
    setCh(fresh); markSaved(fresh); setSaveMsg('New challenge — unsaved');
  };
  const onSave = async () => {
    if (!user?.id) { setSaveMsg('Sign in to save'); return; }
    setSaveMsg('Saving…');
    const res = await saveChallenge(ch, user.id, ch.creator || user.email?.split('@')[0] || 'anon');
    if (res.error) { setSaveMsg('Error: ' + res.error); return; }
    const saved = res.id && !ch.id ? { ...ch, id: res.id } : ch;
    if (res.id && !ch.id) setCh(saved);
    markSaved(saved);
    setSaveMsg('Saved ✓');
  };
  const onOpen = async () => {
    if (!user?.id) { setSaveMsg('Sign in to load'); return; }
    setPicker({ rows: [], loading: true });
    const rows = isAdmin ? await listAllChallenges() : await listMyChallenges(user.id);
    setPicker({ rows, loading: false });
  };
  const loadRow = (r: ChallengeRow) => {
    // Prefer the DB COLUMNS (what the Browser/region queries actually filter on) over the embedded
    // JSON, and always land on a concrete game so a re-Save can't silently null it out (which would
    // hide the challenge from every game's Browser). Old rows with no game fall back to the active one.
    const loaded = { ...r.data, id: r.id, game: r.game ?? r.data.game ?? getActiveGame(), region: r.region ?? r.data.region };
    setCh(loaded); markSaved(loaded);
    setPicker(null); setSaveMsg(`Loaded "${r.name}"`);
  };
  const onDeleteRow = async (r: ChallengeRow) => {
    const err = await deleteChallenge(r.id);
    if (err) { setSaveMsg('Delete failed: ' + err); return; }
    setPicker((p) => (p ? { ...p, rows: p.rows.filter((x) => x.id !== r.id) } : p));
    if (ch.id === r.id) { setCh((c) => { const n = clone(c); delete n.id; return n; }); }
  };
  const msgErr = /^(Error|Delete|Sign)/.test(saveMsg);

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
    const col = drop.color ?? defaultColor(drop.type);
    // While THIS card's dropdown is open, hovering an option overrides the thumbnail's monster
    // (shown with that monster's natural default colour).
    const overriding = pinned?.wave === i && pinned?.drop === di && hoverType != null;
    const thumbType = overriding ? hoverType! : drop.type;
    const thumbColor = overriding ? defaultColor(thumbType) : col;
    return (
      <>
        <div onMouseDown={(e) => {
               if (e.button !== 0) return;
               e.stopPropagation(); e.preventDefault();
               const cardEl = (e.currentTarget as HTMLElement).closest('[data-spawn]') as HTMLElement | null;
               const rect = cardEl?.getBoundingClientRect();
               dragHover.current = di; setPreview(null); setPinned(null); setHoverType(null);
               setDrag({ wave: i, from: di, w: rect?.width ?? 220, ox: rect ? e.clientX - rect.left : 110, oy: rect ? e.clientY - rect.top : 16 });
               setDragPos({ x: e.clientX, y: e.clientY });
             }}
             style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, cursor: 'grab', userSelect: 'none' }}>
          {/* The big floating preview shows ONLY while hovering this little square (not the whole card). */}
          <div style={{ display: 'flex' }}
               onMouseEnter={(e) => {
                 const cardEl = (e.currentTarget as HTMLElement).closest('[data-spawn]') as HTMLElement | null;
                 if (cardEl) { const p = boxPos(cardEl.getBoundingClientRect()); setPreview({ wave: i, drop: di, x: p.x, y: p.y }); }
               }}
               onMouseLeave={() => setPreview((pp) => (pp && pp.wave === i && pp.drop === di ? null : pp))}>
            <MonsterThumb type={thumbType} color={thumbColor} size={60} />
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#9fb4d0' }}><span style={{ color: '#5e7494' }}>⠿</span> Spawn {di + 1}</div>
              <div style={{ fontSize: 11, color: '#7fd0ff', marginTop: 2 }}>@ {fmtMS(startAt)}</div>
            </div>
            <button style={{ ...btn(), padding: '1px 7px', fontSize: 11 }} onMouseDown={(e) => e.stopPropagation()} onClick={() => setConfirmDel({ wave: i, drop: di })}>✕</button>
          </div>
        </div>
        <label style={lbl}>Monster</label>
        <MonsterSelect value={drop.type} onChange={(t) => patchDrop(i, di, { type: t })}
                       onOpen={(x, y) => setPinned({ wave: i, drop: di, x, y })}
                       onClose={() => { setPinned(null); setHoverType(null); }}
                       onHover={(t) => setHoverType(t)} />
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
            {slider(i, di, 'sizePct', 'Size', drop, 25, 1000, (p) => `${c.baseHeight.toFixed(1)}m → ${(c.baseHeight * p / 100).toFixed(1)}m`)}
            {slider(i, di, 'healthPct', 'Health', drop, 25, 1000, (p) => `${c.baseHealth} → ${Math.round(c.baseHealth * p / 100)} HP`)}
            {slider(i, di, 'speedPct', 'Speed', drop, 25, 1000, (p) => `100% → ${p}%`)}
            {slider(i, di, 'damagePct', 'Damage', drop, 25, 1000, (p) => `100% → ${p}%`)}
          </div>
        )}

        {/* Colour overrides — applied live on the preview (2×2: Saturation, Hue, Tint, Tint Opacity). */}
        {(() => {
          const setCol = (p: Partial<typeof col>) => patchDrop(i, di, { color: { ...col, ...p } });
          return (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid hsla(210,30%,45%,0.25)' }}>
              <label style={lbl}>Color</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={lbl}>Saturation: {col.sat}%</label>
                  <input type="range" className="chal-slider" min={0} max={200} step={5} value={col.sat} style={{ width: '100%' }} onChange={(e) => setCol({ sat: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={lbl}>Hue: {col.hue}°</label>
                  <input type="range" className="chal-hue" min={0} max={360} step={2} value={col.hue} style={{ width: '100%' }} onChange={(e) => setCol({ hue: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={lbl}>Tint</label>
                  <input type="color" value={col.tint} onChange={(e) => setCol({ tint: e.target.value })}
                         style={{ width: '100%', height: 26, padding: 0, border: '1px solid hsla(210,30%,45%,0.4)', borderRadius: 5, background: 'transparent', cursor: 'pointer' }} />
                </div>
                <div>
                  <label style={lbl}>Tint Opacity: {col.tintAmt}%</label>
                  <input type="range" className="chal-slider" min={0} max={100} step={5} value={col.tintAmt} style={{ width: '100%' }} onChange={(e) => setCol({ tintAmt: Number(e.target.value) })} />
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={lbl}>Tint Blend</label>
                <select style={inp} value={col.blend ?? 'normal'} onChange={(e) => setCol({ blend: e.target.value })}>
                  {BLEND_MODES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
          );
        })()}
      </>
    );
  };

  // Unsaved-changes flag: true when ch differs from the last saved/loaded snapshot (drives Save pulse).
  const chJson = JSON.stringify(ch);
  if (savedJson.current === null) savedJson.current = chJson;   // first render: current state is the baseline
  const dirty = chJson !== savedJson.current;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      <style>{`
        input[type=range].chal-slider { -webkit-appearance:none; appearance:none; height:6px; border-radius:3px; background:hsla(220,25%,8%,0.95); border:1px solid hsla(210,30%,45%,0.5); outline:none; }
        input[type=range].chal-slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:14px; height:14px; border-radius:50%; background:#5cc8ff; cursor:pointer; }
        input[type=range].chal-slider::-moz-range-thumb { width:14px; height:14px; border:none; border-radius:50%; background:#5cc8ff; cursor:pointer; }
        input[type=range].chal-slider::-moz-range-track { height:6px; border-radius:3px; background:hsla(220,25%,8%,0.95); }
        input[type=range].chal-hue { -webkit-appearance:none; appearance:none; height:8px; border-radius:4px; outline:none; border:1px solid hsla(210,30%,45%,0.5);
          background:linear-gradient(90deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000); }
        input[type=range].chal-hue::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:14px; height:14px; border-radius:50%; background:#fff; border:1px solid #2a3550; cursor:pointer; }
        input[type=range].chal-hue::-moz-range-thumb { width:14px; height:14px; border-radius:50%; background:#fff; border:1px solid #2a3550; cursor:pointer; }
        .chal-scroll { scrollbar-color: hsla(210,30%,45%,0.7) hsla(220,25%,10%,0.5); scrollbar-width: thin; }
        .chal-scroll::-webkit-scrollbar { width:10px; height:10px; }
        .chal-scroll::-webkit-scrollbar-track { background:hsla(220,25%,8%,0.5); }
        .chal-scroll::-webkit-scrollbar-thumb { background:hsla(210,30%,42%,0.8); border-radius:5px; }
        .chal-scroll::-webkit-scrollbar-thumb:hover { background:hsla(210,35%,52%,0.9); }
        input[type=number].chal-num::-webkit-inner-spin-button, input[type=number].chal-num::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
        input[type=number].chal-num { -moz-appearance:textfield; appearance:textfield; }
        @keyframes chalSavePulse { 0%,100% { box-shadow: 0 0 0 0 hsla(140,75%,55%,0); } 50% { box-shadow: 0 0 13px 3px hsla(140,75%,55%,0.8); } }
        .chal-save-pulse { animation: chalSavePulse 1.15s ease-in-out infinite; }
      `}</style>
      <div style={{ width: '95vw', height: '95vh', background: PANEL_BG, border: '1px solid hsla(210,40%,55%,0.4)', borderRadius: 12, boxShadow: '0 12px 60px #000', display: 'flex', flexDirection: 'column', color: '#e8eefb', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ ...CHROME, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid hsla(210,30%,40%,0.3)' }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 1 }}>Challenge Creator</div>
          <button style={btn()} onClick={() => setCreatorOpen(false)}>✕ Close</button>
        </div>

        {/* General info — challenge-level (cost/pool live here, NOT per wave) */}
        <div style={{ ...CHROME, padding: '10px 16px', borderBottom: '1px solid hsla(210,30%,40%,0.2)' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* LEFT — name/creator/game, then (after a blank line) the challenge-level economy + region.
                Takes 60% so the banner gets 40%; its inner rows flex, so they shrink proportionally. */}
            <div style={{ flex: 6, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 2 }}><label style={lbl}>Challenge Name</label><input style={inp} value={ch.name} onChange={(e) => patch({ name: e.target.value })} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>Creator</label><input style={inp} value={ch.creator} onChange={(e) => patch({ creator: e.target.value })} /></div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Game</label>
                  {/* A challenge only runs in its game. Defaults to the game you're in; change to author for another. */}
                  <select style={inp} value={ch.game ?? getActiveGame()} onChange={(e) => patch({ game: e.target.value })}>
                    {GAME_LIST.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                </div>
              </div>
              {/* blank line before the four challenge-level sections */}
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <div style={{ flex: 1 }}><label style={lbl}>Cost to Play (Divi)</label><NumField style={inp} value={ch.costDivi || undefined} allowEmpty placeholder="0" onChange={(n) => patch({ costDivi: n ?? 0 })} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>% to Prize Pool</label><NumField style={inp} value={ch.pctToPool || undefined} allowEmpty placeholder="0" onChange={(n) => patch({ pctToPool: n ?? 0 })} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>Divi Reward (to beat)</label><NumField style={inp} value={ch.rewardDivi || undefined} allowEmpty placeholder="0" onChange={(n) => patch({ rewardDivi: n ?? 0 })} /></div>
                {isSuper && (
                  <div style={{ flex: 1 }}>
                    <label style={{ ...lbl, color: '#ffd27f' }}>Open-World Region (superadmin)</label>
                    <select style={inp} value={ch.region ?? ''}
                            onChange={(e) => { const r = e.target.value || undefined; patch({ region: r, spawn: r ? (ch.spawn ?? regionCoords(r)) : ch.spawn }); }}>
                      <option value="">— not a region spawner —</option>
                      {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {/* Action buttons — under the economy row. Save pulses green when there are unsaved edits. */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                <button style={btn()} onClick={newChallenge}>＋ New</button>
                <button style={btn()} onClick={onOpen}>📂 Open</button>
                <button className={dirty ? 'chal-save-pulse' : undefined} style={{ ...btn(true), background: dirty ? '#2e8b57' : undefined }} onClick={onSave}>💾 Save</button>
                <button style={{ ...btn(true), background: '#3a6ea8' }} onClick={run}>▶ Run</button>
                {saveMsg && <span style={{ fontSize: 11, color: msgErr ? '#ff9b9b' : '#8fe6a0' }}>{saveMsg}</span>}
              </div>
              {/* Region spawn coordinates (superadmin, only when this challenge IS a region spawner).
                  Defaults to the region's known coords; edit + Save to update where its monsters appear. */}
              {isSuper && ch.region && (() => {
                const sp = ch.spawn ?? regionCoords(ch.region);
                const setSp = (idx: number, n: number | undefined) => { const s: [number, number, number] = [sp[0], sp[1], sp[2]]; s[idx] = n ?? 0; patch({ spawn: s }); };
                return (
                  <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'flex-end' }}>
                    <div style={{ fontSize: 11, color: '#ffd27f', fontWeight: 700, alignSelf: 'center', whiteSpace: 'nowrap' }}>📍 {ch.region} spawn</div>
                    <div style={{ flex: 1 }}><label style={lbl}>Spawn X</label><NumField style={inp} value={sp[0]} onChange={(n) => setSp(0, n)} /></div>
                    <div style={{ flex: 1 }}><label style={lbl}>Spawn Y</label><NumField style={inp} value={sp[1]} onChange={(n) => setSp(1, n)} /></div>
                    <div style={{ flex: 1 }}><label style={lbl}>Spawn Z</label><NumField style={inp} value={sp[2]} onChange={(n) => setSp(2, n)} /></div>
                    <div style={{ flex: 1 }}><label style={lbl}>Scatter Radius</label><NumField style={inp} value={ch.scatterRadius ?? 14} min={0} onChange={(n) => patch({ scatterRadius: n ?? 14 })} /></div>
                  </div>
                );
              })()}
            </div>
            {/* RIGHT — Banner as its own sub-panel, 40% of the width so it shows much larger */}
            <div style={{ ...card, flex: 4, minWidth: 0 }}>
              <label style={lbl}>Banner (4×1)</label>
              <BannerInput value={ch.banner} onChange={(v) => patch({ banner: v })} />
            </div>
          </div>
        </div>

        {/* Wave nav — click to scroll the stack to that wave */}
        <div style={{ ...CHROME, display: 'flex', gap: 5, padding: '8px 16px', flexWrap: 'wrap', borderBottom: '1px solid hsla(210,30%,40%,0.2)' }}>
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

      {/* Big floating turntable above the hovered card (or the card whose dropdown is open — then
          hovering an option overrides the shown monster). */}
      {(() => {
        const a = drag ? null : (pinned ?? preview);
        if (!a) return null;
        const d = ch.waves[a.wave]?.drops[a.drop];
        if (!d) return null;
        const over = hoverType != null && pinned != null;
        const t = over ? hoverType : d.type;
        const col = over ? defaultColor(t) : (d.color ?? defaultColor(d.type));
        return <MonsterPreviewBox type={t} name={cat(t).name} color={col} x={a.x} y={a.y} />;
      })()}

      {/* The single transparent canvas that draws every card's small monster thumbnail. */}
      <MonsterPortCanvas />

      {/* Open: pick a saved challenge (your own; admins see everyone's). */}
      {picker && (
        <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, zIndex: 215, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}>
          <div onClick={(e) => e.stopPropagation()} className="chal-scroll" style={{ ...card, width: 580, maxHeight: '72vh', overflowY: 'auto', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{isAdmin ? 'All Challenges' : 'My Challenges'}</div>
              <button style={btn()} onClick={() => setPicker(null)}>Close</button>
            </div>
            {picker.loading ? <div style={{ color: '#9fb4d0' }}>Loading…</div>
              : picker.rows.length === 0 ? <div style={{ color: '#9fb4d0' }}>No saved challenges yet — make one and hit Save.</div>
              : picker.rows.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderBottom: '1px solid hsla(210,25%,35%,0.25)' }}>
                  {/* Banner thumbnail (4×1) so it's easy to recognise which challenge to edit. */}
                  {r.data?.banner
                    ? <img src={r.data.banner} alt="" style={{ width: 200, height: 50, objectFit: 'cover', borderRadius: 6, flexShrink: 0, background: '#0d141f' }} />
                    : <div style={{ width: 200, height: 50, borderRadius: 6, flexShrink: 0, background: '#0d141f', border: '1px dashed hsla(210,25%,45%,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52617a', fontSize: 10 }}>no banner</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}{r.game && <span style={{ fontSize: 11, color: '#7fd0ff', fontWeight: 700 }}> · {r.game}</span>}{r.region && <span style={{ fontSize: 11, color: '#ffd27f', fontWeight: 700 }}> · region: {r.region}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#7e90ad' }}>{r.creator_name ?? '—'} · {new Date(r.updated_at).toLocaleString()}</div>
                  </div>
                  <button style={btn(true)} onClick={() => loadRow(r)}>Open</button>
                  {(isAdmin || r.user_id === user?.id) && <button style={{ ...btn(), background: '#7a2b2b' }} onClick={() => onDeleteRow(r)}>Delete</button>}
                </div>
              ))}
          </div>
        </div>
      )}

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
