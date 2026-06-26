// SpecialsModal — the superadmin-only "SPECIAL" manager opened from the Challenge Creator. Lists every
// special set piece as its own card (name + auto code# + world + LIVE toggle). Create one here, name it,
// flip it LIVE when its hard-coded behaviour is ready, and it then appears in the +Special dropdown on
// each wave. DB-backed (siege_specials, superadmin RLS). Styled to match the Creator panel.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHALLENGE_WORLDS } from '../siegeAreas';
import { listSpecials, createSpecial, updateSpecial, deleteSpecial, type SpecialRow } from './specialsStorage';

const card: React.CSSProperties = { background: 'hsla(220, 28%, 16%, 0.8)', border: '1px solid hsla(210, 30%, 45%, 0.35)', borderRadius: 8, padding: 12 };
const lbl: React.CSSProperties = { fontSize: 11, color: '#9fb4d0', fontWeight: 600, display: 'block', marginBottom: 3 };
const inp: React.CSSProperties = { width: '100%', background: 'hsla(220,25%,8%,0.9)', border: '1px solid hsla(210,30%,45%,0.4)', borderRadius: 5, color: '#e8eefb', padding: '5px 7px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' };
const btn = (active = false): React.CSSProperties => ({ background: active ? '#3a6ea8' : 'hsla(220,25%,22%,0.9)', border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 6, color: '#e8eefb', padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' });
const PURPLE = '#7a2db8';

// One editable special card — holds its own draft so typing never re-queries; Save persists.
function SpecialCard({ row, onChanged }: { row: SpecialRow; onChanged: () => void }) {
  const [name, setName] = useState(row.name);
  const [world, setWorld] = useState(row.world ?? '');
  const [desc, setDesc] = useState(row.description ?? '');
  const [msg, setMsg] = useState('');
  useEffect(() => { setName(row.name); setWorld(row.world ?? ''); setDesc(row.description ?? ''); }, [row.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = name !== row.name || world !== (row.world ?? '') || desc !== (row.description ?? '');
  const save = async () => {
    setMsg('Saving…');
    const err = await updateSpecial(row.id, { name: name || `Special ${row.code}`, world: world || null, description: desc || null });
    setMsg(err ? 'Error: ' + err : 'Saved ✓'); if (!err) onChanged();
  };
  const toggleLive = async () => {
    const err = await updateSpecial(row.id, { live: !row.live });
    if (err) setMsg('Error: ' + err); else onChanged();
  };
  const del = async () => { if (!confirm(`Delete special #${row.code} "${row.name}"?`)) return; const err = await deleteSpecial(row.id); if (err) setMsg('Error: ' + err); else onChanged(); };

  const worldLabel = CHALLENGE_WORLDS.find((w) => w.mapId === row.world)?.label;
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8, borderColor: row.live ? 'hsla(140,60%,50%,0.6)' : 'hsla(210,30%,45%,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: PURPLE, background: '#fff', borderRadius: 5, padding: '2px 8px' }}>#{row.code}</span>
        <span style={{ flex: 1 }} />
        <button onClick={toggleLive} style={{ ...btn(row.live), background: row.live ? '#2e8b57' : 'hsla(220,25%,22%,0.9)', padding: '4px 12px', fontSize: 12 }}>
          {row.live ? '● LIVE' : '○ Draft'}
        </button>
        <button onClick={del} style={{ ...btn(), background: '#7a2b2b', padding: '4px 9px', fontSize: 12 }}>🗑</button>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 2 }}><label style={lbl}>Name</label><input style={inp} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>World</label>
          <select style={inp} value={world} onChange={(e) => setWorld(e.target.value)}>
            <option value="">Any world</option>
            {CHALLENGE_WORLDS.map((w) => <option key={w.mapId} value={w.mapId}>{w.label}</option>)}
          </select>
        </div>
      </div>
      <div><label style={lbl}>Description / notes</label><textarea style={{ ...inp, resize: 'vertical', minHeight: 40 }} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className={dirty ? undefined : undefined} style={{ ...btn(true), background: dirty ? '#2e8b57' : undefined, opacity: dirty ? 1 : 0.6 }} onClick={save} disabled={!dirty}>💾 Save</button>
        {row.live && !worldLabel && row.world && <span style={{ fontSize: 11, color: '#ff9b9b' }}>world no longer exists</span>}
        {msg && <span style={{ fontSize: 11, color: msg.startsWith('Error') ? '#ff9b9b' : '#8fe6a0' }}>{msg}</span>}
        <span style={{ fontSize: 11, color: '#7e90ad', marginLeft: 'auto' }}>code #{row.code} — drop it from a wave's +Special</span>
      </div>
    </div>
  );
}

export function SpecialsModal({ game, userId, onClose, onChanged }: { game: string; userId: string; onClose: () => void; onChanged?: () => void }) {
  const [rows, setRows] = useState<SpecialRow[] | null>(null);
  const [msg, setMsg] = useState('');
  const reload = () => { listSpecials(game).then(setRows); onChanged?.(); };
  useEffect(() => { reload(); }, [game]);   // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setMsg('Adding…');
    const res = await createSpecial(game, userId);
    setMsg(res.error ? 'Error: ' + res.error : ''); reload();
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', fontFamily: 'var(--hud-font, Inter, sans-serif)' }}>
      <div onClick={(e) => e.stopPropagation()} className="chal-scroll"
           style={{ width: 640, maxWidth: '94vw', maxHeight: '86vh', overflowY: 'auto', background: 'hsla(222, 32%, 10%, 0.98)', border: `1px solid ${PURPLE}`, borderRadius: 12, boxShadow: '0 12px 60px #000', color: '#e8eefb', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 1, color: '#fff' }}>
            <span style={{ color: PURPLE, background: '#fff', borderRadius: 5, padding: '2px 8px', marginRight: 8 }}>SPECIAL</span>
            Set Pieces
          </div>
          <button style={btn()} onClick={onClose}>✕ Close</button>
        </div>
        <div style={{ fontSize: 12, color: '#9fb4d0', marginBottom: 12 }}>
          Superadmin-only, hard-coded set pieces for <b>{game}</b>. Create a card, name it, then flip it LIVE once its behaviour is built — LIVE specials appear in each wave's <b>+Special</b> menu (filtered to the wave's world).
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button style={{ ...btn(), background: '#fff', color: PURPLE, border: `1px solid ${PURPLE}`, fontWeight: 800 }} onClick={add}>＋ Add Special</button>
          {msg && <span style={{ fontSize: 11, color: msg.startsWith('Error') ? '#ff9b9b' : '#8fe6a0' }}>{msg}</span>}
        </div>
        {rows === null ? <div style={{ color: '#9fb4d0' }}>Loading…</div>
          : rows.length === 0 ? <div style={{ color: '#9fb4d0' }}>No specials yet — add one above.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{rows.map((r) => <SpecialCard key={r.id} row={r} onChanged={reload} />)}</div>}
      </div>
    </div>,
    document.body,
  );
}
