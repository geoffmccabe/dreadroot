// TriagePanel — press C while the laser is on something to capture it as an entry.
// Each entry gets issue-tag buttons (out of place, rotated, bad texture, etc.).
// "Copy worklist" puts the whole tagged list on the clipboard for Geoff to paste
// back so fixes can be worked through systematically.

import { useEffect, useState } from 'react';
import { isTypingTarget } from '@/lib/isTypingTarget';
import { heading } from './playerState';
import { probeState } from './probeState';

const TAGS = ['good', 'bad', 'out of place', 'sideways', 'rotated 90', 'rotated 180',
  'upside down', 'too big', 'too small', 'bad/no texture', 'missing parts',
  'floating', 'sunk in ground'];

interface Entry {
  item: string; px: number; pz: number; hx: number; hy: number; hz: number;
  deg: number; dir: string; issues: string[]; note?: string;
}

function buildText(entries: Entry[]): string {
  return `SW triage worklist (${entries.length} items), from laser-probe:\n\n` +
    entries.map((e, i) =>
      `#${i + 1}  ${e.item}\n    issues: ${e.issues.join(', ') || '(none tagged)'}` +
      (e.note ? `\n    note: ${e.note}` : '') +
      `\n    me@ x=${e.px.toFixed(0)} z=${e.pz.toFixed(0)} facing ${e.deg}°${e.dir}; hit x=${e.hx.toFixed(1)} y=${e.hy.toFixed(1)} z=${e.hz.toFixed(1)}`
    ).join('\n\n');
}

export function TriagePanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [copied, setCopied] = useState(false);
  const [menuIdx, setMenuIdx] = useState<number | null>(null); // entry whose tag dropdown is open

  // Always keep the full worklist on the clipboard so it can be pasted any time.
  useEffect(() => {
    if (entries.length) navigator.clipboard?.writeText(buildText(entries)).catch(() => {});
  }, [entries]);

  // Quick-tag from the world: Shift+click = instant "bad"; right-click = open dropdown.
  useEffect(() => {
    const onTriage = (e: Event) => {
      const d = (e as CustomEvent).detail as Entry & { bad?: boolean; menu?: boolean };
      setEntries((es) => {
        const next = [...es, { item: d.item, px: d.px, pz: d.pz, hx: d.hx, hy: d.hy, hz: d.hz,
          deg: d.deg, dir: d.dir, issues: d.bad ? ['bad'] : [] }];
        if (d.menu) setMenuIdx(next.length - 1);
        return next;
      });
    };
    window.addEventListener('sw-triage', onTriage);
    return () => window.removeEventListener('sw-triage', onTriage);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e)) return;
      // All triage keys are GATED on the laser being ON, so they never clash with normal
      // play keys. While the laser is ON: C = plain capture; B = flag BAD, G = flag GOOD
      // (B/G also need a hit) — one keypress per item, no clicking. With the laser OFF,
      // C falls through so the "!c" challenge-browser command keeps working.
      let flag: string[] | null = null;
      if (probeState.on && e.code === 'KeyC') flag = [];
      else if (probeState.on && probeState.hasHit && e.code === 'KeyB') flag = ['bad'];
      else if (probeState.on && probeState.hasHit && e.code === 'KeyG') flag = ['good'];
      if (!flag) return;
      // While the laser owns B/G, stop them reaching Block-mode / Grenade handlers.
      e.preventDefault(); e.stopImmediatePropagation();
      const h = heading(probeState.dirX, probeState.dirZ);
      setEntries((es) => [...es, {
        item: probeState.on ? (probeState.hit || '(laser hit nothing)') : '(laser off — press L)',
        px: probeState.camX, pz: probeState.camZ, hx: probeState.hx, hy: probeState.hy, hz: probeState.hz,
        deg: h.deg, dir: h.dir, issues: flag,
      }]);
    };
    // CAPTURE phase so we intercept B/G BEFORE the Block-mode / Grenade keybinds fire.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const toggle = (i: number, t: string) => setEntries((es) =>
    es.map((e, idx) => idx !== i ? e
      : { ...e, issues: e.issues.includes(t) ? e.issues.filter((x) => x !== t) : [...e.issues, t] }));
  const remove = (i: number) => setEntries((es) => es.filter((_, idx) => idx !== i));
  const setNote = (i: number) => {
    const n = window.prompt('Note for this item:', entries[i].note || '');
    if (n != null) setEntries((es) => es.map((e, idx) => idx !== i ? e : { ...e, note: n }));
  };
  const copyAll = () => {
    navigator.clipboard?.writeText(buildText(entries)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  };

  // Right-click tag dropdown (rendered at screen center, where the crosshair is).
  const dropdown = menuIdx !== null && entries[menuIdx] ? (
    <div style={{
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
      background: 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6,
      padding: 8, zIndex: 1000, pointerEvents: 'auto', width: 200,
      font: '12px ui-monospace, monospace', color: '#fff',
    }}>
      <div style={{ marginBottom: 4, color: '#ffd' }}>Tag #{menuIdx + 1}:</div>
      {TAGS.map((t) => (
        <div key={t} onClick={() => { toggle(menuIdx, t); setMenuIdx(null); }}
          style={{ cursor: 'pointer', padding: '3px 6px', borderRadius: 3 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(70,130,180,0.7)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>{t}</div>
      ))}
      <div onClick={() => setMenuIdx(null)} style={{ cursor: 'pointer', padding: '3px 6px', color: '#f99' }}>cancel</div>
    </div>
  ) : null;

  if (!entries.length) return dropdown;

  const tagBtn = (active: boolean): React.CSSProperties => ({
    cursor: 'pointer', font: '10px ui-monospace, monospace', color: '#fff',
    background: active ? (/*good*/ 'rgba(60,160,90,0.95)') : 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.25)', borderRadius: 3, padding: '1px 5px', margin: '1px',
  });

  return (
   <>
    {dropdown}
    <div style={{
      position: 'fixed', right: 10, top: 70, width: 340, maxHeight: '78vh', overflowY: 'auto',
      background: 'rgba(0,0,0,0.72)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 10,
      padding: 8, color: '#fff', font: '11px ui-monospace, monospace', pointerEvents: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong>Triage ({entries.length})</strong>
        <span>
          <button onClick={copyAll} style={{ ...tagBtn(false), background: copied ? 'rgba(60,160,90,0.95)' : 'rgba(70,130,180,0.9)' }}>
            {copied ? 'Copied!' : 'Copy worklist'}
          </button>
          <button onClick={() => setEntries([])} style={tagBtn(false)}>clear</button>
        </span>
      </div>
      {entries.map((e, i) => (
        <div key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.15)', padding: '5px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#ffd', wordBreak: 'break-all' }}>#{i + 1} {e.item}</span>
            <span>
              <button onClick={() => setNote(i)} style={tagBtn(false)}>+ note</button>
              <button onClick={() => remove(i)} style={tagBtn(false)}>✕</button>
            </span>
          </div>
          {e.note && <div style={{ color: '#9cf', margin: '2px 0' }}>📝 {e.note}</div>}
          <div style={{ marginTop: 3 }}>
            {TAGS.map((t) => (
              <button key={t} onClick={() => toggle(i, t)} style={tagBtn(e.issues.includes(t))}>{t}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
   </>
  );
}
