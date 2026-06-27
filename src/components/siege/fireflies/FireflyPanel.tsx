// FireflyPanel — the world-builder panel for authoring a map's ambient firefly life. Opened with
// "@FF". Modelled on the Challenge Creator (same dark-HUD chrome + card styling): a stack of cards,
// each card = one firefly SPECIES, edited live (the GPU renderer reads the same store, so every
// slider updates the swarm instantly). Each card carries a GLOBAL spawn code shown as "@F<code>".
//
// Commands (handled here so the firefly system is self-contained):
//   @FF        → toggle this panel
//   @F<code>   → spawn (enable) the species with that global code — own species only, unless
//                admin/superadmin (then any).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/AuthContext';
import { fetchRoles } from '../challenge/challengeStorage';
import { FireflySpecies, useFireflyStore } from './fireflySpecies';

// ── shared HUD styling (mirrors ChallengeCreatorPanel) ──────────────
const PANEL_BG = 'hsla(222, 32%, 10%, 0.96)';
const card: React.CSSProperties = { background: 'hsla(220, 28%, 16%, 0.8)', border: '1px solid hsla(210, 30%, 45%, 0.35)', borderRadius: 8, padding: 12 };
const lbl: React.CSSProperties = { fontSize: 11, color: '#9fb4d0', fontWeight: 600, display: 'block', marginBottom: 3 };
const inp: React.CSSProperties = { width: '100%', background: 'hsla(220,25%,8%,0.9)', border: '1px solid hsla(210,30%,45%,0.4)', borderRadius: 5, color: '#e8eefb', padding: '5px 7px', fontSize: 13, fontFamily: 'inherit' };
const btn = (active = false): React.CSSProperties => ({ background: active ? '#3a6ea8' : 'hsla(220,25%,22%,0.9)', border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 6, color: '#e8eefb', padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });
const section: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: '#7fd0ff', textTransform: 'uppercase', margin: '12px 0 6px' };
const isTyping = () => { const t = document.activeElement?.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'; };

// One labelled slider with a live numeric readout. Writes through to the store on change.
function Slider({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <label style={lbl}>{label}</label>
        <span style={{ fontSize: 11, color: '#cfe0f5', fontWeight: 700 }}>{fmt ? fmt(value) : value}</span>
      </div>
      <input type="range" className="ff-slider" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: '100%' }} />
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function SpeciesCard({ sp }: { sp: FireflySpecies }) {
  const { updateSpecies, removeSpecies, duplicateSpecies } = useFireflyStore();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const u = (patch: Partial<FireflySpecies>) => updateSpecies(sp.id, patch);
  const ownerId = user?.id ?? '';

  return (
    <div style={{ ...card, opacity: sp.enabled ? 1 : 0.6 }}>
      {/* card header — code badge, name, enable/dup/delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : 4 }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: '#0c1322', background: '#7fd0ff', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}
              title="Global spawn code — type @F then this number">@F{sp.code || '—'}</span>
        <input style={{ ...inp, flex: 1, fontWeight: 700 }} value={sp.name} onChange={(e) => u({ name: e.target.value })} />
        <button style={btn(sp.enabled)} title="Enable / disable" onClick={() => u({ enabled: !sp.enabled })}>{sp.enabled ? '👁' : '🚫'}</button>
        <button style={btn()} title="Duplicate" onClick={() => duplicateSpecies(sp.id, ownerId)}>⧉</button>
        <button style={{ ...btn(), background: '#7a2b2b' }} title="Delete" onClick={() => removeSpecies(sp.id)}>🗑</button>
        <button style={btn()} title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed((c) => !c)}>{collapsed ? '▸' : '▾'}</button>
      </div>

      {!collapsed && (
        <>
          {/* density + size + colour swatch */}
          <div style={section}>Density &amp; Colour</div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <Slider label="Count" value={sp.count} min={0} max={1000} step={5} onChange={(v) => u({ count: v })} />
              <Slider label="Size" value={sp.size} min={0.3} max={4} step={0.1} fmt={(v) => v.toFixed(1)} onChange={(v) => u({ size: v })} />
            </div>
            <div style={{ width: 70, textAlign: 'center' }}>
              <label style={lbl}>Base</label>
              <input type="color" value={sp.baseColor} onChange={(e) => u({ baseColor: e.target.value })}
                     style={{ width: 56, height: 40, border: '1px solid hsla(210,30%,45%,0.5)', borderRadius: 6, background: 'none', cursor: 'pointer' }} />
            </div>
          </div>
          <Slider label="Drift toward fuchsia" value={sp.towardFuchsia} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => u({ towardFuchsia: v })} />
          <Slider label="Drift toward blue" value={sp.towardBlue} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => u({ towardBlue: v })} />
          <Slider label="Fully-random colour" value={sp.randomColorPct} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => u({ randomColorPct: v })} />

          <div style={section}>Motion</div>
          <Slider label="Speed" value={sp.speed} min={0.05} max={3} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => u({ speed: v })} />
          <Slider label="Speed variance (±)" value={sp.speedVariancePct} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => u({ speedVariancePct: v })} />
          <Slider label="Drift radius" value={sp.driftRadius} min={0} max={8} step={0.1} fmt={(v) => `${v.toFixed(1)} m`} onChange={(v) => u({ driftRadius: v })} />
          <Slider label="Sine-wobble fraction" value={sp.sineWavePct} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => u({ sineWavePct: v })} />

          <div style={section}>High-flyers</div>
          <Slider label="High-flyer fraction" value={sp.highFlyerPct} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => u({ highFlyerPct: v })} />
          <Slider label="High-flyer speed ×" value={sp.highFlyerSpeedMul} min={1} max={6} step={0.5} fmt={(v) => `${v}×`} onChange={(v) => u({ highFlyerSpeedMul: v })} />
          <Slider label="High-flyer Y boost" value={sp.highFlyerYBoost} min={0} max={40} step={1} fmt={(v) => `${v} m`} onChange={(v) => u({ highFlyerYBoost: v })} />

          <div style={section}>Pulse / Blink</div>
          <Slider label="Min lit fraction" value={sp.pulseOnFracMin} min={0.05} max={1} step={0.05} fmt={pct} onChange={(v) => u({ pulseOnFracMin: Math.min(v, sp.pulseOnFracMax) })} />
          <Slider label="Max lit fraction" value={sp.pulseOnFracMax} min={0.05} max={1} step={0.05} fmt={pct} onChange={(v) => u({ pulseOnFracMax: Math.max(v, sp.pulseOnFracMin) })} />
          <Slider label="Fade min" value={sp.fadeMinSec} min={0} max={2} step={0.1} fmt={(v) => `${v.toFixed(1)} s`} onChange={(v) => u({ fadeMinSec: Math.min(v, sp.fadeMaxSec) })} />
          <Slider label="Fade max" value={sp.fadeMaxSec} min={0} max={2} step={0.1} fmt={(v) => `${v.toFixed(1)} s`} onChange={(v) => u({ fadeMaxSec: Math.max(v, sp.fadeMinSec) })} />

          <div style={section}>Area</div>
          <Slider label="Swarm half-extent" value={sp.area} min={5} max={200} step={5} fmt={(v) => `${v} m`} onChange={(v) => u({ area: v })} />
          <Slider label="Y min" value={sp.yMin} min={0} max={40} step={0.5} fmt={(v) => `${v} m`} onChange={(v) => u({ yMin: Math.min(v, sp.yMax) })} />
          <Slider label="Y max" value={sp.yMax} min={0} max={60} step={0.5} fmt={(v) => `${v} m`} onChange={(v) => u({ yMax: Math.max(v, sp.yMin) })} />
        </>
      )}
    </div>
  );
}

export function FireflyPanel() {
  const { species, panelOpen, togglePanel, setPanelOpen, addSpecies, spawnByCode } = useFireflyStore();
  const { user } = useAuth();
  const [roles, setRoles] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const isAdmin = roles.includes('admin') || roles.includes('superadmin');

  useEffect(() => { if (user?.id) fetchRoles(user.id).then(setRoles); }, [user?.id]);

  // ── "@F" command parser: @FF toggles the panel, @F<digits> spawns by code ──
  useEffect(() => {
    let stage: 'idle' | 'at' | 'atf' = 'idle';
    let digits = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => { stage = 'idle'; digits = ''; if (timer) { clearTimeout(timer); timer = null; } };
    const arm = (ms = 1500) => { if (timer) clearTimeout(timer); timer = setTimeout(commit, ms); };
    const commit = () => {
      if (digits) {
        const r = spawnByCode(parseInt(digits, 10), { userId: user?.id ?? '', isAdmin });
        setToast(r === 'ok' ? `Spawned @F${digits}` : r === 'denied' ? `@F${digits}: not yours` : `@F${digits}: no such firefly`);
        setTimeout(() => setToast(''), 1800);
      }
      reset();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const k = e.key;
      if (stage === 'idle') { if (k === '@' || (e.shiftKey && e.code === 'Digit2')) { stage = 'at'; arm(); } return; }
      if (stage === 'at') {
        if (k === 'f' || k === 'F') { stage = 'atf'; arm(); } else reset();
        return;
      }
      // stage 'atf' — a second F toggles the panel; digits accumulate into a spawn code.
      if (k === 'f' || k === 'F') { togglePanel(); reset(); return; }
      if (k >= '0' && k <= '9') { digits += k; arm(700); return; }
      commit();
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (timer) clearTimeout(timer); };
  }, [user?.id, isAdmin, togglePanel, spawnByCode]);

  if (!panelOpen) {
    // still render the toast so @F<code> spawns give feedback with the panel closed
    return toast ? createPortal(<Toast msg={toast} />, document.body) : null;
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      <style>{`
        input[type=range].ff-slider { -webkit-appearance:none; appearance:none; height:6px; border-radius:3px; background:hsla(220,25%,8%,0.95); border:1px solid hsla(210,30%,45%,0.5); outline:none; }
        input[type=range].ff-slider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:14px; height:14px; border-radius:50%; background:#5cc8ff; cursor:pointer; }
        input[type=range].ff-slider::-moz-range-thumb { width:14px; height:14px; border:none; border-radius:50%; background:#5cc8ff; cursor:pointer; }
        .ff-scroll { scrollbar-color: hsla(210,30%,45%,0.7) hsla(220,25%,10%,0.5); scrollbar-width: thin; }
        .ff-scroll::-webkit-scrollbar { width:10px; }
        .ff-scroll::-webkit-scrollbar-track { background:hsla(220,25%,8%,0.5); }
        .ff-scroll::-webkit-scrollbar-thumb { background:hsla(210,30%,42%,0.8); border-radius:5px; }
      `}</style>
      <div style={{ width: 'min(560px, 94vw)', height: '92vh', background: PANEL_BG, border: '1px solid hsla(210,40%,55%,0.4)', borderRadius: 12, boxShadow: '0 12px 60px #000', display: 'flex', flexDirection: 'column', color: '#e8eefb', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid hsla(210,30%,40%,0.3)' }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 1 }}>✨ Fireflies</div>
          <button style={btn()} onClick={() => setPanelOpen(false)}>✕ Close</button>
        </div>
        {/* card stack */}
        <div className="ff-scroll" style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {species.map((sp) => <SpeciesCard key={sp.id} sp={sp} />)}
          {/* + Add Species card */}
          <button onClick={() => addSpecies(user?.id ?? '')}
                  style={{ ...card, border: '1px dashed hsla(210,40%,55%,0.5)', background: 'hsla(220,28%,16%,0.4)', color: '#7fd0ff', fontSize: 15, fontWeight: 800, cursor: 'pointer', padding: 18 }}>
            ＋ Add Species
          </button>
        </div>
      </div>
      {toast && <Toast msg={toast} />}
    </div>,
    document.body,
  );
}

function Toast({ msg }: { msg: string }) {
  return (
    <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 200,
      background: 'hsla(222,32%,12%,0.96)', border: '1px solid hsla(210,40%,55%,0.5)', borderRadius: 8,
      color: '#e8eefb', padding: '8px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      {msg}
    </div>
  );
}
