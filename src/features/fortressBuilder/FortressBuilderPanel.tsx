// Fortress Builder panel — uses the shared GamePanel shell (drag/resize/glow/blur,
// matches the User Panel). Always mounted so it owns the Shift+B hotkey (admins only).
import { useEffect, useState } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { supabase } from '@/integrations/supabase/client';
import { FORTRESS_SEED_KEY } from './fortressSeed';
import { saveSnapshot, listSnapshots, deleteSnapshot, type Snapshot } from './fortressBuilderSnapshots';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { GamePanel } from '@/components/ui/GamePanel';
import { builderStore, useBuilder } from './fortressBuilderStore';

function Row({
  label, min, max, step, value, onChange,
}: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1" data-no-drag>
      <Label className="text-xs">{label}</Label>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function Sel({
  label, value, options, onChange,
}: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1" data-no-drag>
      <Label className="text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs rounded p-1"
        style={{ background: 'hsla(var(--hud-bg-dim))', border: '1px solid hsla(var(--hud-border))', color: 'hsl(var(--hud-text))' }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

const WALL_NAMES = ['Front', 'Right', 'Back', 'Left'];
const TIER_GREY = ['#e6e6e6', '#b0b0b0', '#808080', '#505050', '#2a2a2a']; // matches the preview tiers

export function FortressBuilderPanel() {
  const { userRoles, equippedGear } = useUserData();
  const isAdmin = !!userRoles?.some((r: string) => r === 'admin' || r === 'superadmin');
  const s = useBuilder();

  // Resolve the Fortress Seed item id once, then detect whether the player has one equipped
  // (in any equip slot — the Special slot in practice). Admins can always open the builder.
  const [seedItemId, setSeedItemId] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    (supabase as any).from('items').select('id').eq('key', FORTRESS_SEED_KEY).maybeSingle()
      .then(({ data }: { data: { id: string } | null }) => { if (ok) setSeedItemId(data?.id ?? null); })
      .catch(() => {});
    return () => { ok = false; };
  }, []);
  const hasSeedEquipped = !!seedItemId && (equippedGear ?? []).some((g) => g.itemId === seedItemId);
  const canBuild = isAdmin || hasSeedEquipped;

  // Shift+B toggles the builder (admins, or anyone with a Fortress Seed equipped).
  useEffect(() => {
    if (!canBuild) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.code === 'KeyB' && !e.repeat) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        builderStore.toggleOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canBuild]);

  // Snapshot state — MUST be declared before the early return below. React hooks must run in
  // the same order every render; having these after `if (!isAdmin) return null` changed the hook
  // count when admin status resolved → React error #310 → full white-screen crash.
  const [snapName, setSnapName] = useState('');
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const refreshSnaps = () => listSnapshots().then(setSnaps).catch(() => {});
  useEffect(() => { if (s.isOpen) refreshSnaps(); }, [s.isOpen]);

  if (!canBuild) return null;

  const onSaveSnapshot = async () => {
    const name = snapName.trim();
    if (!name) return;
    const { isOpen, blockCount, ...state } = s; // drop transient fields
    void isOpen; void blockCount;
    await saveSnapshot({ name, createdAt: Date.now(), state });
    setSnapName('');
    refreshSnaps();
  };
  const onLoadSnapshot = (snap: Snapshot) => builderStore.set(snap.state as Partial<typeof s>);
  const onDeleteSnapshot = async (name: string) => { await deleteSnapshot(name); refreshSnaps(); };

  const curExtrude = (s.exFace === 'outside' ? s.extrudeOut : s.extrudeIn)[s.exTier] ?? 0;
  const bumpExtrude = (delta: number) => {
    const src = s.exFace === 'outside' ? s.extrudeOut : s.extrudeIn;
    const arr = [...src];
    arr[s.exTier] = Math.max(-s.T, Math.min(2, (arr[s.exTier] ?? 0) + delta)); // out max +2, in down to -thickness
    builderStore.set(s.exFace === 'outside' ? { extrudeOut: arr } : { extrudeIn: arr });
  };

  return (
    <GamePanel
      open={s.isOpen}
      onClose={() => builderStore.set({ isOpen: false })}
      title="Khaured Fortress Builder"
      defaultWidth={360}
      defaultHeight={620}
      initialStyle={{ top: 72, right: 16 }}
    >
      <div className="space-y-4" data-no-drag>
        {/* Branded header image */}
        <img
          src="/Khaured_fortress_800px.webp"
          alt="Khaured Fortress"
          className="w-full rounded"
        />

        {/* Prompt + Rebuild */}
        <div className="space-y-1">
          <Label className="text-xs">Prompt (guides rebuilds)</Label>
          <textarea
            value={s.prompt}
            onChange={(e) => builderStore.set({ prompt: e.target.value })}
            rows={2}
            placeholder="e.g. taller central spire, wider base…"
            className="w-full text-xs rounded p-2 resize-none"
            style={{ background: 'hsla(var(--hud-bg-dim))', border: '1px solid hsla(var(--hud-border))', color: 'hsl(var(--hud-text))' }}
          />
          <Button
            size="sm"
            className="w-full"
            onClick={() => builderStore.set({ rebuildSeed: Math.floor(Math.random() * 1e9) + 1 })}
          >
            Rebuild (try a different idea)
          </Button>
        </div>

        {/* Saved creations */}
        <div className="space-y-2 pt-1" style={{ borderTop: '1px solid hsla(var(--hud-border))' }} data-no-drag>
          <Label className="text-xs font-semibold">Saved creations</Label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={snapName}
              onChange={(e) => setSnapName(e.target.value)}
              placeholder="name this creation"
              className="flex-1 text-xs rounded p-1"
              style={{ background: 'hsla(var(--hud-bg-dim))', border: '1px solid hsla(var(--hud-border))', color: 'hsl(var(--hud-text))' }}
            />
            <Button size="sm" className="h-7" disabled={!snapName.trim()} onClick={onSaveSnapshot}>Save</Button>
          </div>
          {snaps.length > 0 && (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {snaps.map((sn) => (
                <div key={sn.name} className="flex items-center gap-1 text-xs">
                  <button
                    className="flex-1 text-left truncate px-1 py-0.5 rounded hover:opacity-80"
                    style={{ background: 'hsla(var(--hud-bg-dim))' }}
                    onClick={() => onLoadSnapshot(sn)}
                    title="Load this creation"
                  >
                    {sn.name}
                  </button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onDeleteSnapshot(sn.name)} title="Delete">✕</Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Row label={`Diameter: ${s.D} (fortress ${Math.round(0.6 * s.D)})`} min={20} max={100} step={1} value={s.D} onChange={(v) => builderStore.set({ D: v })} />
        <Row label={`Height: ${s.heightScale.toFixed(2)}×`} min={0.3} max={2} step={0.05} value={s.heightScale} onChange={(v) => builderStore.set({ heightScale: v })} />
        <Row label={`Wall thickness: ${s.T}`} min={1} max={5} step={1} value={s.T} onChange={(v) => builderStore.set({ T: v })} />
        <Row label={`Block size (chunkier): ${s.chunk}`} min={1} max={5} step={1} value={s.chunk} onChange={(v) => builderStore.set({ chunk: v })} />

        {/* Symmetry */}
        <div className="space-y-2 pt-1" style={{ borderTop: '1px solid hsla(var(--hud-border))' }} data-no-drag>
          <Sel
            label="Face symmetry"
            value={s.faceSym}
            options={[{ value: 'none', label: 'None' }, { value: 'lr', label: 'Left-Right' }]}
            onChange={(v) => builderStore.set({ faceSym: v as 'lr' | 'none' })}
          />
          <Button size="sm" variant="outline" className="w-full" disabled={s.faceSym !== 'lr'} onClick={() => builderStore.set({ faceFlip: !s.faceFlip })}>
            Flip {s.faceFlip ? '◀' : '▶'}
          </Button>
          <Sel
            label="Wall symmetry"
            value={s.wallSym}
            options={[{ value: '4way', label: '4-Way (all same)' }, { value: '2way', label: '2-Way (opposite pairs)' }, { value: 'none', label: 'None (all different)' }]}
            onChange={(v) => builderStore.set({ wallSym: v as '4way' | '2way' | 'none' })}
          />
        </div>

        {/* Parapet corner towers */}
        <div className="space-y-2 pt-1" style={{ borderTop: '1px solid hsla(var(--hud-border))' }} data-no-drag>
          <Button size="sm" variant={s.parapetOn ? 'default' : 'outline'} className="w-full" onClick={() => builderStore.set({ parapetOn: !s.parapetOn })}>
            Corner towers (parapet): {s.parapetOn ? 'ON' : 'OFF'}
          </Button>
          {s.parapetOn && (
            <>
              <Row label={`Tower width: +${s.parapetWidth}`} min={0} max={8} step={1} value={s.parapetWidth} onChange={(v) => builderStore.set({ parapetWidth: v })} />
              <Row label={`Tower height: +${s.parapetHeight}`} min={0} max={20} step={1} value={s.parapetHeight} onChange={(v) => builderStore.set({ parapetHeight: v })} />
            </>
          )}
        </div>

        {/* Entry */}
        <div className="space-y-2 pt-1" style={{ borderTop: '1px solid hsla(var(--hud-border))' }} data-no-drag>
          <Label className="text-xs font-semibold">Entry</Label>
          <Row label={`Width: ${s.entryW || 'none'}`} min={0} max={16} step={1} value={s.entryW} onChange={(v) => builderStore.set({ entryW: v })} />
          <Row label={`Height: ${s.entryH}`} min={1} max={16} step={1} value={s.entryH} onChange={(v) => builderStore.set({ entryH: v })} />
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Wall</Label>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-6 w-7 p-0" onClick={() => builderStore.set({ entryWall: (s.entryWall + 3) % 4 })}>←</Button>
              <span className="text-xs w-12 text-center">{WALL_NAMES[s.entryWall]}</span>
              <Button size="sm" variant="outline" className="h-6 w-7 p-0" onClick={() => builderStore.set({ entryWall: (s.entryWall + 1) % 4 })}>→</Button>
            </div>
          </div>
          <Row label={`Vert (lift): ${s.entryVert}`} min={0} max={5} step={1} value={s.entryVert} onChange={(v) => builderStore.set({ entryVert: v })} />
          <Button
            size="sm"
            variant={s.stairs ? 'default' : 'outline'}
            className="w-full"
            onClick={() => builderStore.set({ stairs: !s.stairs })}
          >
            Stairs: {s.stairs ? 'ON' : 'OFF'}{s.entryVert < 2 ? ' (needs lift ≥ 2)' : ''}
          </Button>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Tint</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={s.tintHex} onChange={(e) => builderStore.set({ tintHex: e.target.value })} className="h-7 w-12 rounded" />
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => builderStore.set({ tintHex: '#ffffff' })}>reset</Button>
          </div>
        </div>

        {/* Barrier toggle (20-60-20 ring; keeps monsters out) */}
        <Button
          size="sm"
          variant={s.barrierOn ? 'default' : 'outline'}
          className="w-full"
          onClick={() => builderStore.set({ barrierOn: !s.barrierOn })}
        >
          {s.barrierOn ? 'Barrier wall: ON' : 'Barrier wall: OFF'}
        </Button>

        <div className="text-xs opacity-70">
          {`${s.blockCount.toLocaleString()} blocks`}
        </div>
        <div className="text-[10px] opacity-50">Shift+B toggles · preview builds ~35 blocks ahead of you</div>

        {/* Extrude — push a chosen colour's blocks out (relief) or in (windows) */}
        <div className="space-y-2 pt-2" style={{ borderTop: '1px solid hsla(var(--hud-border))' }} data-no-drag>
          <Label className="text-xs font-semibold">Extrude</Label>
          <div className="flex items-center gap-1">
            {TIER_GREY.map((c, i) => (
              <button
                key={i}
                onClick={() => builderStore.set({ exTier: i })}
                className="h-7 flex-1 rounded"
                title={`Stone ${i + 1}`}
                style={{
                  // Flat tier grey — 5 clearly distinct shades (the multiply-over-texture
                  // blend washed them all to the same mid-grey).
                  backgroundColor: c,
                  outline: s.exTier === i ? '2px solid hsl(var(--hud-text-bright))' : '1px solid hsla(var(--hud-border))',
                  outlineOffset: '-1px',
                }}
              />
            ))}
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant={s.exFace === 'outside' ? 'default' : 'outline'} className="flex-1 h-7" onClick={() => builderStore.set({ exFace: 'outside' })}>Outside</Button>
            <Button size="sm" variant={s.exFace === 'inside' ? 'default' : 'outline'} className="flex-1 h-7" onClick={() => builderStore.set({ exFace: 'inside' })}>Inside</Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" className="h-7 w-9 p-0" onClick={() => bumpExtrude(-1)}>−</Button>
            <span className="text-xs text-center flex-1">
              {curExtrude > 0 ? `+${curExtrude} out` : curExtrude < 0 ? `${-curExtrude} in (recess)` : 'flush'}
            </span>
            <Button size="sm" variant="outline" className="h-7 w-9 p-0" onClick={() => bumpExtrude(1)}>+</Button>
          </div>
          <div className="text-[10px] opacity-50">+ protrudes up to 2 · − recesses up to wall thickness ({s.T}) — all the way = window</div>

          {/* Lighting on lit parts (emissive, flickering) */}
          <div className="space-y-2 pt-2">
            <Label className="text-xs font-semibold">Lighting</Label>
            <div className="flex items-center gap-2">
              <Button size="sm" variant={s.extrudeLightOn ? 'default' : 'outline'} className="flex-1 h-6 text-xs" onClick={() => builderStore.set({ extrudeLightOn: !s.extrudeLightOn })}>
                Extrude light {s.extrudeLightOn ? 'ON' : 'OFF'}
              </Button>
              <input type="color" value={s.extrudeLightColor} onChange={(e) => builderStore.set({ extrudeLightColor: e.target.value })} className="h-6 w-9 rounded" />
            </div>
            <Row label={`Extrude intensity: ${s.extrudeLightIntensity.toFixed(1)}`} min={0} max={3} step={0.1} value={s.extrudeLightIntensity} onChange={(v) => builderStore.set({ extrudeLightIntensity: v })} />
            <Row label={`Extrude spread: ${s.extrudeLightSpread.toFixed(0)}m`} min={2} max={24} step={1} value={s.extrudeLightSpread} onChange={(v) => builderStore.set({ extrudeLightSpread: v })} />
            <div className="flex items-center gap-2">
              <Button size="sm" variant={s.insetLightOn ? 'default' : 'outline'} className="flex-1 h-6 text-xs" onClick={() => builderStore.set({ insetLightOn: !s.insetLightOn })}>
                Inset light {s.insetLightOn ? 'ON' : 'OFF'}
              </Button>
              <input type="color" value={s.insetLightColor} onChange={(e) => builderStore.set({ insetLightColor: e.target.value })} className="h-6 w-9 rounded" />
            </div>
            <Row label={`Inset intensity: ${s.insetLightIntensity.toFixed(1)}`} min={0} max={3} step={0.1} value={s.insetLightIntensity} onChange={(v) => builderStore.set({ insetLightIntensity: v })} />
            <Row label={`Inset spread: ${s.insetLightSpread.toFixed(0)}m`} min={2} max={24} step={1} value={s.insetLightSpread} onChange={(v) => builderStore.set({ insetLightSpread: v })} />
          </div>
        </div>
      </div>
    </GamePanel>
  );
}
