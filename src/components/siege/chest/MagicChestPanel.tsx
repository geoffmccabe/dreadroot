// MagicChestPanel — HUD for the Magic Chest. Shows the "MAGIC CHEST" prompt in range; on V it
// calls the server RPC open_prize_chest (validates + consumes key 152, rolls + grants the prize,
// returns the 40-item reel), then spins a reel that lands on the prize (index 39) and reveals it.
// All economy is server-side; this is presentation + the trigger.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSiegeLobbyZones, getChestInRange } from '../siegeLobbyZones';
import { useChestPhase, startChest, revealChest, closeChest, getChestReel, getChestPrize } from './chestState';
import { PRIZE_INDEX, generatePrizeList } from './chestDrops';

const TILE = 72;          // px per reel item
const sprite = (id: number) => `/item-sprites/${id}.webp`;

export function MagicChestPanel() {
  const { chestInRange } = useSiegeLobbyZones();
  const phase = useChestPhase();
  const [msg, setMsg] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const strip = useRef<HTMLDivElement>(null);

  // V opens the chest while in range + idle (capture so it doesn't hit other V handlers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyV' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!getChestInRange() || phaseRef.current !== 'idle') return;
      const t = (e.target as HTMLElement | null)?.tagName; if (t === 'INPUT' || t === 'TEXTAREA') return;
      e.preventDefault(); e.stopImmediatePropagation();
      void open();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const phaseRef = useRef(phase); phaseRef.current = phase;

  const open = async () => {
    setMsg('Opening…');
    try {
      const { data, error } = await supabase.rpc('open_prize_chest', { p_request_id: crypto.randomUUID() });
      const res = data as { ok?: boolean; prize?: number; error?: string } | null;
      if (error || !res?.ok || res.prize == null) { setMsg(res?.error || error?.message || 'The chest mechanism is not ready yet.'); setTimeout(() => setMsg(null), 2500); return; }
      setMsg(null);
      // Server decided the prize (key already consumed + prize granted server-side). Build a local
      // filler reel and drop the real prize at the landing index for the spin.
      const reel = generatePrizeList(); reel[PRIZE_INDEX] = res.prize;
      startChest(reel, res.prize);
      // Land the reel on the prize (centered), then reveal.
      setOffset(0);
      requestAnimationFrame(() => setOffset(-(PRIZE_INDEX * TILE)));
      setTimeout(() => revealChest(), 3800);
    } catch (err) {
      setMsg('The chest mechanism is not ready yet.'); setTimeout(() => setMsg(null), 2500);
    }
  };

  if (phase === 'idle') {
    if (!chestInRange && !msg) return null;
    return (
      <div style={{ position: 'fixed', bottom: 150, left: '50%', transform: 'translateX(-50%)', zIndex: 100, pointerEvents: 'none',
        padding: '10px 18px', borderRadius: 'var(--hud-radius, 10px)', background: 'hsla(280, 40%, 18%, 0.78)',
        border: '1px solid hsla(290, 60%, 60%, 0.6)', color: '#f3e9ff', font: '14px ui-monospace, monospace',
        textShadow: '0 1px 2px rgba(0,0,0,0.8)', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
        {msg ?? <>✦ <b>MAGIC CHEST</b> — press <b style={{ color: 'hsl(48,90%,68%)' }}>V</b> (needs a Key)</>}
      </div>
    );
  }

  // Spinning / revealed overlay
  const reel = getChestReel();
  const prize = getChestPrize();
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(6,4,12,0.72)', pointerEvents: 'auto' }}>
      <div style={{ color: '#f3e9ff', font: '700 22px ui-monospace, monospace', marginBottom: 14, letterSpacing: 1 }}>✦ MAGIC CHEST ✦</div>
      {/* Reel window */}
      <div style={{ position: 'relative', width: TILE * 7, height: TILE + 16, overflow: 'hidden',
        border: '2px solid hsla(290,60%,60%,0.8)', borderRadius: 10, background: 'rgba(20,12,32,0.9)' }}>
        {/* center marker */}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 3, marginLeft: -1.5, background: 'hsl(48,90%,68%)', zIndex: 2, boxShadow: '0 0 8px hsl(48,90%,68%)' }} />
        <div ref={strip} style={{ display: 'flex', alignItems: 'center', height: '100%', paddingLeft: TILE * 3,
          transform: `translateX(${offset}px)`, transition: phase === 'spinning' ? 'transform 3.6s cubic-bezier(0.12,0.7,0.1,1)' : 'none' }}>
          {reel.map((id, i) => (
            <div key={i} style={{ width: TILE, height: TILE, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: phase === 'revealed' && i === PRIZE_INDEX ? 1 : phase === 'revealed' ? 0.4 : 1 }}>
              <img src={sprite(id)} alt="" width={TILE - 14} height={TILE - 14} style={{ imageRendering: 'pixelated' }}
                onError={(e) => { (e.currentTarget.style.visibility = 'hidden'); }} />
            </div>
          ))}
        </div>
      </div>
      {phase === 'revealed' && (
        <div style={{ marginTop: 18, textAlign: 'center', color: '#fff', font: '16px ui-monospace, monospace' }}>
          <div style={{ marginBottom: 8 }}>You received <b style={{ color: 'hsl(48,90%,68%)' }}>item #{prize}</b>!</div>
          <img src={sprite(prize)} alt="" width={96} height={96} style={{ imageRendering: 'pixelated', filter: 'drop-shadow(0 0 12px hsl(48,90%,68%))' }} />
          <div><button onClick={() => { closeChest(); }} style={{ marginTop: 14, cursor: 'pointer', font: '13px ui-monospace, monospace',
            color: '#fff', background: 'hsla(290,50%,40%,0.9)', border: '1px solid hsla(290,60%,70%,0.7)', borderRadius: 8, padding: '6px 18px' }}>Collect</button></div>
        </div>
      )}
    </div>
  );
}
