// Fortress Builder panel (DOM, outside the Canvas). Always mounted so it can own the
// Shift+B open/close hotkey (admin/superadmin only); renders the styled card when open.
// Writes params to the external store; the in-Canvas preview rebuilds live.
import { useEffect } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { builderStore, useBuilder } from './fortressBuilderStore';

function Row({
  label, min, max, step, value, onChange,
}: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
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

  if (!isAdmin || !s.isOpen) return null;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => builderStore.set({ imageSrc: String(ev.target?.result || ''), imageName: f.name });
    reader.readAsDataURL(f);
  };

  return (
    <div style={{ position: 'absolute', top: 80, right: 16, width: 320, zIndex: 50 }}>
      <Card className="waterfall-card">
        <CardHeader className="flex flex-row items-center justify-between p-3 pb-0">
          <CardTitle className="text-base">Fortress Builder</CardTitle>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => builderStore.set({ isOpen: false })}>✕</Button>
        </CardHeader>
        <CardContent className="space-y-4 p-3">
          <div className="space-y-1">
            <Label className="text-xs">Image{s.imageName ? `: ${s.imageName}` : ''}</Label>
            <input type="file" accept="image/*" onChange={onFile} className="block w-full text-xs" />
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
          <div className="text-xs opacity-70">
            {s.imageSrc ? `${s.blockCount.toLocaleString()} blocks` : 'Upload an image to begin'}
          </div>
          <div className="text-[10px] opacity-50">Shift+B toggles · preview builds ~35 blocks ahead of you</div>
        </CardContent>
      </Card>
    </div>
  );
}
