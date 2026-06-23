// FountainPanel — "THE FOUNTAIN" modal. Appears when the player is within the fountain zone.
// Donate Divi → global double-drops for everyone (server-validated fountain_donate RPC) → fires a
// Discord alert + refreshes the Fountainhead leaderboard. The donation amount and leaderboard come
// from the server; the buff is shared via fountainState polling.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDivi } from '@/features/marketplace/hooks/useDivi';
import { useSiegeLobbyZones } from '../siegeLobbyZones';
import { useFountain, refreshFountain, getFountainEndsAt } from './fountainState';

function timeLeft(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return '';
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function FountainPanel() {
  const { fountainInRange } = useSiegeLobbyZones();
  const { user } = useAuth();
  const { balance } = useDivi(user?.id ?? null);
  const f = useFountain();
  const [amt, setAmt] = useState('100');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, tick] = useState(0);
  const unlocked = useRef(false);

  // Free the cursor so the modal is usable; tick the countdown.
  useEffect(() => {
    if (fountainInRange && !unlocked.current) { unlocked.current = true; document.exitPointerLock?.(); }
    if (!fountainInRange) unlocked.current = false;
  }, [fountainInRange]);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);

  if (!fountainInRange) return null;

  const donate = async () => {
    const n = parseInt(amt, 10);
    if (!Number.isFinite(n) || n <= 0) { setMsg('Enter an amount.'); return; }
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.rpc('fountain_donate', { p_amount: n });
      const res = data as { ok?: boolean; error?: string; donor?: string } | null;
      if (error || !res?.ok) { setMsg(res?.error || error?.message || 'The fountain is not ready yet.'); setBusy(false); return; }
      await refreshFountain();
      // Notify Discord (best-effort; the donation itself was server-validated).
      supabase.functions.invoke('fountain-alert', { body: { name: res.donor ?? 'Someone', amount: n } }).catch(() => {});
      setMsg('The gods thank you. 🪙');
    } catch { setMsg('The fountain is not ready yet.'); }
    setBusy(false);
  };

  const card: React.CSSProperties = { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
    width: 420, maxHeight: '86vh', overflowY: 'auto', zIndex: 1200, pointerEvents: 'auto',
    background: 'rgba(8,16,28,0.94)', border: '1px solid hsla(200,70%,55%,0.6)', borderRadius: 14, padding: 18,
    color: '#e8f3ff', font: '13px ui-monospace, monospace', boxShadow: '0 6px 30px rgba(0,0,0,0.6)' };

  return (
    <div style={card}>
      <div style={{ font: '700 20px ui-monospace, monospace', color: '#8fd6ff', marginBottom: 6, letterSpacing: 1 }}>⛲ THE FOUNTAIN</div>
      <div style={{ opacity: 0.9, lineHeight: 1.5, marginBottom: 12 }}>
        Donate <b>$DIVI</b> to grant <b>Double-Drops for everyone</b> playing the game. The more you give, the longer it lasts.
      </div>

      <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: f.active ? 'hsla(140,50%,30%,0.4)' : 'rgba(255,255,255,0.06)' }}>
        {f.active
          ? <>✨ <b>Double-drops ACTIVE</b> — {timeLeft(getFountainEndsAt())} left{f.donor ? ` (thanks, ${f.donor})` : ''}</>
          : <>Double-drops are not active right now.</>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ opacity: 0.85 }}>Your Divi: <b>{Math.floor(balance).toLocaleString()}</b></span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="amount"
          style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 6, padding: '6px 8px', color: '#fff' }} />
        <button disabled={busy} onClick={donate} style={{ cursor: 'pointer', color: '#04121f', fontWeight: 700,
          background: 'hsl(195,80%,60%)', border: 'none', borderRadius: 6, padding: '6px 16px' }}>{busy ? '…' : 'Donate'}</button>
      </div>
      {msg && <div style={{ marginBottom: 8, color: msg.includes('thank') ? '#9be8a0' : '#ffb3b3' }}>{msg}</div>}

      <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 10 }}>
        <div style={{ fontWeight: 700, color: '#8fd6ff', marginBottom: 6 }}>🏆 Top Fountainheads</div>
        {f.leaders.length === 0 && <div style={{ opacity: 0.6 }}>No donations yet — be the first.</div>}
        {f.leaders.slice(0, 20).map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.95, padding: '1px 0' }}>
            <span>{i + 1}. {l.name}</span><span>{Math.floor(l.total_divi).toLocaleString()} ◈</span>
          </div>
        ))}
      </div>
      <div style={{ opacity: 0.5, fontSize: 11, marginTop: 10 }}>Walk away to close.</div>
    </div>
  );
}
