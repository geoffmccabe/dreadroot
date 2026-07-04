// FireflyPanel — the world-builder panel for authoring a map's ambient firefly life. Opened with
// "@FF". Uses the shared BUILDER panel styling (waterfall-card Card + theme classes + shadcn Button,
// draggable by its title bar — same chrome as the Model Placer / Terrain panels), NOT a bespoke modal.
// A stack of cards, each = one firefly SPECIES, edited live (the GPU renderer reads the same store, so
// every slider updates the swarm instantly). Each card carries a GLOBAL spawn code shown as "@F<code>".
//
// The swarm splits into TYPES (Regular · High-flyers) by WEIGHT — each type is its own sub-panel with a
// weight and a live xx.xx% share of the total. Commands:
//   @FF        → toggle this panel
//   @F<code>   → spawn (enable) the species with that global code — own species only, unless admin.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useDraggablePanel } from '../useDraggablePanel';
import { useAuth } from '@/contexts/AuthContext';
import { fetchRoles } from '../challenge/challengeStorage';
import { FireflySpecies, useFireflyStore } from './fireflySpecies';

const isTyping = () => { const t = document.activeElement?.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'; };

// A builder-style labelled slider: muted label + value readout on the right, full-width range below.
function Slider({ label, val, min, max, step, suffix, pct, on }: {
  label: string; val: number; min: number; max: number; step: number; suffix?: string; pct?: boolean; on: (v: number) => void;
}) {
  const shown = pct ? `${Math.round(val * 100)}%` : `${Math.round(val * 100) / 100}${suffix ?? ''}`;
  return (
    <div className="mb-1">
      <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><b className="text-foreground">{shown}</b></div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => on(parseFloat(e.target.value))} className="w-full" />
    </div>
  );
}

// A plain shared sub-panel (bordered box + bold muted title).
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5 rounded border border-border/40 p-1.5">
      <div className="mb-1 font-bold text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

// A firefly TYPE sub-panel: header shows its live share (xx.xx%) + a weight input; body holds the
// type-specific controls. Tinted (primary/5) so the type panels read as a distinct group.
function TypeSection({ title, weight, share, onWeight, children }: {
  title: string; weight: number; share: string; onWeight: (v: number) => void; children?: React.ReactNode;
}) {
  return (
    <div className="mt-1 rounded border border-primary/30 bg-primary/5 p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-bold text-foreground">{title}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <b className="text-foreground tabular-nums">{share}</b>
          <span>weight ⚖</span>
          <input type="number" min={0} step={1} value={weight} onChange={(e) => onWeight(Math.max(0, +e.target.value))}
                 className="w-12 rounded bg-background/60 px-1 py-0.5 text-right text-[10px]" />
        </span>
      </div>
      {children}
    </div>
  );
}

function SpeciesCard({ sp }: { sp: FireflySpecies }) {
  const { updateSpecies, removeSpecies, duplicateSpecies } = useFireflyStore();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const u = (patch: Partial<FireflySpecies>) => updateSpecies(sp.id, patch);
  const ownerId = user?.id ?? '';
  const wTotal = sp.regularWeight + sp.highFlyerWeight;
  const share = (w: number) => `${wTotal > 0 ? ((w / wTotal) * 100).toFixed(2) : '0.00'}%`;

  return (
    <div className="rounded border border-border/50 bg-background/40 p-2" style={{ opacity: sp.enabled ? 1 : 0.55 }}>
      {/* header — code badge, name, enable/dup/delete/collapse */}
      <div className="mb-1 flex items-center gap-1">
        <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-black text-primary-foreground" title="Global spawn code — type @F then this number">@F{sp.code || '—'}</span>
        <input className="min-w-0 flex-1 rounded bg-background/60 px-1.5 py-0.5 text-[11px] font-bold text-foreground" value={sp.name} onChange={(e) => u({ name: e.target.value })} />
        <Button size="sm" variant={sp.enabled ? 'default' : 'outline'} className="h-6 px-1.5 text-[10px]" title="Enable / disable" onClick={() => u({ enabled: !sp.enabled })}>{sp.enabled ? '👁' : '🚫'}</Button>
        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" title="Duplicate" onClick={() => duplicateSpecies(sp.id, ownerId)}>⧉</Button>
        <Button size="sm" variant="destructive" className="h-6 px-1.5 text-[10px]" title="Delete" onClick={() => removeSpecies(sp.id)}>🗑</Button>
        <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed((c) => !c)}>{collapsed ? '▸' : '▾'}</Button>
      </div>

      {!collapsed && (
        <>
          <Section title="Density & Colour">
            <Slider label="Count" val={sp.count} min={0} max={1000} step={5} on={(v) => u({ count: v })} />
            <Slider label="Size" val={sp.size} min={0.3} max={4} step={0.1} on={(v) => u({ size: v })} />
            <div className="mb-1 flex items-center justify-between">
              <span className="text-muted-foreground">Base colour</span>
              <input type="color" value={sp.baseColor} onChange={(e) => u({ baseColor: e.target.value })}
                     className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent" />
            </div>
            <Slider label="Toward fuchsia" val={sp.towardFuchsia} min={0} max={1} step={0.05} pct on={(v) => u({ towardFuchsia: v })} />
            <Slider label="Toward blue" val={sp.towardBlue} min={0} max={1} step={0.05} pct on={(v) => u({ towardBlue: v })} />
            <Slider label="Fully-random colour" val={sp.randomColorPct} min={0} max={1} step={0.05} pct on={(v) => u({ randomColorPct: v })} />
          </Section>

          <Section title="Motion (all types)">
            <Slider label="Speed" val={sp.speed} min={0.05} max={3} step={0.05} on={(v) => u({ speed: v })} />
            <Slider label="Speed variance ±" val={sp.speedVariancePct} min={0} max={1} step={0.05} pct on={(v) => u({ speedVariancePct: v })} />
            <Slider label="Drift radius" val={sp.driftRadius} min={0} max={8} step={0.1} suffix=" m" on={(v) => u({ driftRadius: v })} />
            <Slider label="Sine-wobble fraction" val={sp.sineWavePct} min={0} max={1} step={0.05} pct on={(v) => u({ sineWavePct: v })} />
          </Section>

          <div className="mb-0.5 mt-2 text-[10px] font-bold uppercase tracking-wide text-primary">Types (split by weight)</div>
          <TypeSection title="Regular" weight={sp.regularWeight} share={share(sp.regularWeight)} onWeight={(v) => u({ regularWeight: v })}>
            <div className="text-muted-foreground">Ordinary drifters — they use the Motion settings above.</div>
          </TypeSection>
          <TypeSection title="High-flyers" weight={sp.highFlyerWeight} share={share(sp.highFlyerWeight)} onWeight={(v) => u({ highFlyerWeight: v })}>
            <Slider label="Speed ×" val={sp.highFlyerSpeedMul} min={1} max={6} step={0.5} suffix="×" on={(v) => u({ highFlyerSpeedMul: v })} />
            <Slider label="Y boost" val={sp.highFlyerYBoost} min={0} max={40} step={1} suffix=" m" on={(v) => u({ highFlyerYBoost: v })} />
          </TypeSection>

          <Section title="Pulse / Blink">
            <Slider label="Min lit fraction" val={sp.pulseOnFracMin} min={0.05} max={1} step={0.05} pct on={(v) => u({ pulseOnFracMin: Math.min(v, sp.pulseOnFracMax) })} />
            <Slider label="Max lit fraction" val={sp.pulseOnFracMax} min={0.05} max={1} step={0.05} pct on={(v) => u({ pulseOnFracMax: Math.max(v, sp.pulseOnFracMin) })} />
            <Slider label="Fade min" val={sp.fadeMinSec} min={0} max={2} step={0.1} suffix=" s" on={(v) => u({ fadeMinSec: Math.min(v, sp.fadeMaxSec) })} />
            <Slider label="Fade max" val={sp.fadeMaxSec} min={0} max={2} step={0.1} suffix=" s" on={(v) => u({ fadeMaxSec: Math.max(v, sp.fadeMinSec) })} />
          </Section>

          <Section title="Area">
            <Slider label="Swarm half-extent" val={sp.area} min={5} max={200} step={5} suffix=" m" on={(v) => u({ area: v })} />
            <Slider label="Y min" val={sp.yMin} min={0} max={40} step={0.5} suffix=" m" on={(v) => u({ yMin: Math.min(v, sp.yMax) })} />
            <Slider label="Y max" val={sp.yMax} min={0} max={60} step={0.5} suffix=" m" on={(v) => u({ yMax: Math.max(v, sp.yMin) })} />
          </Section>
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
  const { pos, handleProps } = useDraggablePanel({ left: Math.max(8, window.innerWidth - 360), top: 80 });

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

  if (!panelOpen) return toast ? <Toast msg={toast} /> : null;

  return (
    <>
      <Card className="waterfall-card fixed z-50 flex flex-col overflow-hidden p-0 font-mono text-xs" style={{ left: pos.left, top: pos.top, width: 340, height: '86vh' }}>
        {/* draggable title bar */}
        <div className="flex items-center justify-between border-b border-border/40 px-2 py-1.5">
          <span {...handleProps} className="select-none font-bold text-primary" title="Drag to move">⠿ ✨ Fireflies</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setPanelOpen(false)}>✕ Close</Button>
        </div>
        {/* species stack */}
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {species.map((sp) => <SpeciesCard key={sp.id} sp={sp} />)}
          <Button variant="outline" className="h-8 w-full text-[11px] text-primary" onClick={() => addSpecies(user?.id ?? '')}>＋ Add Species</Button>
        </div>
      </Card>
      {toast && <Toast msg={toast} />}
    </>
  );
}

function Toast({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-20 left-1/2 z-[200] -translate-x-1/2 rounded border border-border bg-background/95 px-3 py-1.5 font-mono text-[11px] font-bold text-foreground">
      {msg}
    </div>
  );
}
