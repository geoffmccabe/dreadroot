// Fortress Builder panel — uses the shared GamePanel shell (drag/resize/glow/blur,
// matches the User Panel). Always mounted so it owns the Shift+B hotkey (admins only).
import { useEffect } from 'react';
import { useUserData } from '@/hooks/useUserData';
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

export function FortressBuilderPanel() {
  const { userRoles } = useUserData();
  const isAdmin = !!userRoles?.some((r: string) => r === 'admin' || r === 'superadmin');
  const s = useBuilder();

  // Shift+B toggles the builder (admins only).
  useEffect(() => {
    if (!isAdmin) return;
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
  }, [isAdmin]);

  if (!isAdmin) return null;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => builderStore.set({ imageSrc: String(ev.target?.result || ''), imageName: f.name });
    reader.readAsDataURL(f);
  };

  return (
    <GamePanel
      open={s.isOpen}
      onClose={() => builderStore.set({ isOpen: false })}
      title="Fortress Builder"
      defaultWidth={360}
      defaultHeight={620}
      initialStyle={{ top: 72, right: 16 }}
    >
      <div className="space-y-4" data-no-drag>
        {/* Source image preview */}
        {s.imageSrc ? (
          <img
            src={s.imageSrc}
            alt={s.imageName}
            className="w-full max-h-40 object-contain rounded"
            style={{ background: 'hsla(var(--hud-bg-dim))' }}
          />
        ) : null}

        <div className="space-y-1">
          <Label className="text-xs">Image{s.imageName ? `: ${s.imageName}` : ''}</Label>
          <input type="file" accept="image/*" onChange={onFile} className="block w-full text-xs" />
        </div>

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

        <Row label={`Diameter: ${s.D} (fortress ${Math.round(0.6 * s.D)})`} min={20} max={100} step={1} value={s.D} onChange={(v) => builderStore.set({ D: v })} />
        <Row label={`Height: ${s.heightScale.toFixed(2)}×`} min={0.3} max={2} step={0.05} value={s.heightScale} onChange={(v) => builderStore.set({ heightScale: v })} />
        <Row label={`Wall thickness: ${s.T}`} min={1} max={5} step={1} value={s.T} onChange={(v) => builderStore.set({ T: v })} />

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
          {s.imageSrc ? `${s.blockCount.toLocaleString()} blocks` : 'Upload an image to begin'}
        </div>
        <div className="text-[10px] opacity-50">Shift+B toggles · preview builds ~35 blocks ahead of you</div>
      </div>
    </GamePanel>
  );
}
