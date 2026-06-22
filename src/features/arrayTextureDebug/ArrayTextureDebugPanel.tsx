// Stage-1 DOM panel (admin, Shift+L): drives + displays the array-texture engine.
// Buttons load synthetic tiles, stress-load to force LRU eviction, and clear. The grid
// of layer-quads renders in the Canvas (ArrayTextureDebug). Proves the engine before
// any renderer uses it. Does nothing in the live render path.
import { useEffect, useState } from 'react';
import { useUserData } from '@/hooks/useUserData';
import { GamePanel } from '@/components/ui/GamePanel';
import { Button } from '@/components/ui/button';
import { isArrayBackend, setTextureBackend } from '@/config/textureBackend';
import { supabase } from '@/integrations/supabase/client';
import { loadKtx2, isKtx2Ready } from '@/lib/ktx2Runtime';
import { arrayDebug, useArrayDebug } from './arrayDebugStore';

export function ArrayTextureDebugPanel() {
  const { userRoles } = useUserData();
  const isAdmin = !!userRoles?.some((r: string) => r === 'admin' || r === 'superadmin');
  const snap = useArrayDebug();
  const [ktx2Status, setKtx2Status] = useState<string>('');

  // Phase 4a proof: grab a real `.ktx2` from the DB, decode it via the runtime, and show
  // the device's transcoded format + dimensions + mip count. Confirms the decode path
  // works end-to-end before 4b wires it into the compressed array.
  const probeKtx2 = async () => {
    setKtx2Status('probing…');
    if (!isKtx2Ready()) { setKtx2Status('runtime not inited (flip to ARRAY + reload)'); return; }
    try {
      const { data } = await supabase
        .from('shombie_definitions' as never)
        .select('texture_url_ktx2')
        .not('texture_url_ktx2', 'is', null)
        .limit(1);
      const url = (data?.[0] as { texture_url_ktx2?: string } | undefined)?.texture_url_ktx2;
      if (!url) { setKtx2Status('no encoded .ktx2 found in shombie_definitions'); return; }
      const { texture, probe } = await loadKtx2(url);
      setKtx2Status(`${probe.formatLabel} · ${probe.width}×${probe.height} · ${probe.mipCount} mips · ${probe.compressed ? 'COMPRESSED ✓' : 'rgba fallback'}`);
      texture.dispose();
    } catch (e) {
      setKtx2Status('load failed: ' + ((e as Error)?.message ?? String(e)));
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.code === 'KeyL' && !e.repeat) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        arrayDebug.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAdmin]);

  if (!isAdmin || !snap.open) return null;
  const s = snap.stats;

  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex justify-between text-xs"><span className="opacity-70">{label}</span><span className="font-mono">{value}</span></div>
  );

  return (
    <GamePanel
      open={snap.open}
      onClose={() => arrayDebug.toggle()}
      title="Array Texture (Stage 1 debug)"
      defaultWidth={300}
      defaultHeight={360}
      initialStyle={{ top: 72, left: 16 }}
    >
      <div className="space-y-3" data-no-drag>
        <div className="space-y-1">
          <Stat label="Initialised" value={s ? String(s.inited) : '…'} />
          <Stat label="Layers (capacity)" value={s?.layerCount ?? '…'} />
          <Stat label="Layer resolution" value={s ? `${s.layerRes}²` : '…'} />
          <Stat label="Resident" value={s?.resident ?? '…'} />
          <Stat label="Ready (uploaded)" value={s?.ready ?? '…'} />
          <Stat label="Loading" value={s?.loading ?? '…'} />
          <Stat label="Free" value={s?.free ?? '…'} />
          <Stat label="Evictions" value={s?.evictions ?? '…'} />
        </div>
        <div className="text-xs">
          Backend: <span className="font-mono">{isArrayBackend() ? 'array (flag ON)' : 'atlas (default)'}</span>
        </div>
        <Button
          size="sm"
          variant={isArrayBackend() ? 'default' : 'outline'}
          className="w-full"
          onClick={() => { setTextureBackend(isArrayBackend() ? 'atlas' : 'array'); location.reload(); }}
        >
          {isArrayBackend() ? 'Switch to ATLAS (reload)' : 'Switch to ARRAY backend (reload)'}
        </Button>
        <div className="text-[10px] opacity-60">
          Flip to ARRAY + reload, then "Show game layers" to see real game textures stream into layers.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => arrayDebug.dispatch('game')}>Show game layers</Button>
          <Button size="sm" variant="outline" onClick={() => arrayDebug.dispatch('load', 24)}>Load 24 tiles</Button>
          <Button size="sm" variant="outline" onClick={() => arrayDebug.dispatch('stress', 2000)}>Stress 2000 (evict)</Button>
          <Button size="sm" variant="ghost" onClick={() => arrayDebug.dispatch('clear')}>Clear grid</Button>
        </div>
        <div className="text-[10px] opacity-50">
          The coloured numbered grid in front of you is each tile sampled from its own array layer
          (proves sampler2DArray works). Stress-load forces LRU eviction — watch Evictions climb.
        </div>
        <div className="border-t border-white/10 pt-2 space-y-1">
          <Button size="sm" variant="outline" className="w-full" onClick={() => { void probeKtx2(); }}>
            Probe KTX2 decode (Phase 4a)
          </Button>
          {ktx2Status && <div className="text-[10px] font-mono opacity-80 break-all">{ktx2Status}</div>}
        </div>
      </div>
    </GamePanel>
  );
}
