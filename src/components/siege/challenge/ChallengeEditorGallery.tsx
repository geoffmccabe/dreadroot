// ChallengeEditorGallery — the "!e" entry point. Shows the signed-in creator's OWN challenges as cards
// (others' challenges never appear here) plus a big "＋" card to make a new one. Picking a card opens
// the full Creator panel loaded with that challenge; "＋" opens it on a fresh blank. Mirrors the look of
// the "!c" Browser, but it's an EDIT picker (own-only) rather than a play list.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { isGalleryOpen, subscribeGallery, setGalleryOpen, openCreatorWith } from './challengeCreatorStore';
import { listMyChallenges, type ChallengeRow } from './challengeStorage';
import { useAuth } from '@/contexts/AuthContext';
import { getActiveGame } from '@/config/activeGame';

const PANEL_BG = 'hsla(222, 32%, 10%, 0.97)';
const card: React.CSSProperties = { background: 'hsla(220, 28%, 16%, 0.85)', border: '1px solid hsla(210, 30%, 45%, 0.35)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const btn: React.CSSProperties = { background: 'hsla(220,25%,22%,0.9)', border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 6, color: '#e8eefb', padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };

const totalMonsters = (r: ChallengeRow) =>
  (r.data?.waves ?? []).reduce((a, w) => a + (w.drops ?? []).reduce((b, d) => b + (d.count || 1), 0), 0);

export function ChallengeEditorGallery() {
  const open = useSyncExternalStore(subscribeGallery, isGalleryOpen, isGalleryOpen);
  const { user } = useAuth();
  const [rows, setRows] = useState<ChallengeRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    document.exitPointerLock?.();
    setRows(null);
    let cancelled = false;
    if (user?.id) listMyChallenges(user.id).then((r) => { if (!cancelled) setRows(r); });
    else setRows([]);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isGalleryOpen()) { e.stopPropagation(); setGalleryOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => { cancelled = true; window.removeEventListener('keydown', onKey, true); };
  }, [open, user?.id]);

  if (!open) return null;

  const editNew = () => { setGalleryOpen(false); openCreatorWith('new'); };
  const edit = (r: ChallengeRow) => { setGalleryOpen(false); openCreatorWith(r); };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 123, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hud-font, Inter, sans-serif)', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}>
      <style>{`
        .chal-scroll { scrollbar-color: hsla(210,30%,45%,0.7) hsla(220,25%,10%,0.5); scrollbar-width: thin; }
        .chal-scroll::-webkit-scrollbar { width:10px; height:10px; }
        .chal-scroll::-webkit-scrollbar-track { background:hsla(220,25%,8%,0.5); }
        .chal-scroll::-webkit-scrollbar-thumb { background:hsla(210,30%,42%,0.8); border-radius:5px; }
        .ceg-card { transition: border-color 0.12s, transform 0.12s; }
        .ceg-card:hover { border-color: hsl(var(--panel-glow, 205 70% 55%) / 0.8); transform: translateY(-2px); }
      `}</style>
      <div style={{ width: '92vw', height: '90vh', background: PANEL_BG, border: '1px solid hsla(210,40%,55%,0.4)', borderRadius: 12, boxShadow: '0 12px 60px #000', display: 'flex', flexDirection: 'column', color: '#e8eefb', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid hsla(210,30%,40%,0.3)' }}>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1 }}>Challenge Editor</div>
          <button style={btn} onClick={() => setGalleryOpen(false)}>✕ Close</button>
        </div>

        <div className="chal-scroll" style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          <div style={{ fontSize: 13, color: '#9fb4d0', marginBottom: 14 }}>Your challenges — pick one to edit, or make a new one. (You only see your own here.)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
            {/* ＋ New challenge placeholder */}
            <button className="ceg-card" onClick={editNew}
                    style={{ ...card, cursor: 'pointer', alignItems: 'center', justifyContent: 'center', minHeight: 180, color: '#e8eefb', font: 'inherit', borderStyle: 'dashed', borderColor: 'hsla(210,30%,55%,0.5)' }}>
              <div style={{ fontSize: 54, fontWeight: 300, lineHeight: 1, color: '#7fd0ff' }}>＋</div>
              <div style={{ fontSize: 14, fontWeight: 800, marginTop: 8 }}>New Challenge</div>
            </button>

            {rows === null ? (
              <div style={{ color: '#9fb4d0', padding: 20 }}>Loading…</div>
            ) : (
              rows.map((r) => (
                <button key={r.id} className="ceg-card" onClick={() => edit(r)}
                        style={{ ...card, cursor: 'pointer', padding: 0, textAlign: 'left', color: '#e8eefb', font: 'inherit' }}>
                  {r.data?.banner ? (
                    <img src={r.data.banner} alt="" style={{ width: '100%', aspectRatio: '4 / 1', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '4 / 1', background: 'linear-gradient(135deg,#243049,#3a4a6b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9fb4d0', fontWeight: 800, fontSize: 15, padding: 6, textAlign: 'center' }}>{r.name}</div>
                  )}
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || 'Untitled'}</div>
                    <div style={{ fontSize: 11, color: '#7e90ad' }}>{(r.data?.waves?.length ?? 0)} waves · {totalMonsters(r)} monsters · {r.game ?? '—'}</div>
                    <div style={{ fontSize: 12, color: '#7fd0ff', fontWeight: 700, marginTop: 'auto' }}>✎ Edit</div>
                  </div>
                </button>
              ))
            )}
          </div>
          {rows && rows.length === 0 && (
            <div style={{ color: '#9fb4d0', marginTop: 16 }}>{user?.id ? 'You haven’t made any challenges yet — hit ＋ to start one.' : 'Sign in to save challenges. You can still build one with ＋.'}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
