// Drop-to-world target. Sits a half-slot to the RIGHT of the last QA slot and is only
// visible while an item is on the cursor (carried between Inventory / QA / Equip / Vault).
// Flow: hover the held item over the globe → it flashes + shows "DROP TO WORLD". Release
// over it → "CONFIRM?" replaces that text and YES/NO buttons replace the globe. YES drops
// the item into the world; NO (or letting the carry end) cancels. This is now the ONLY way
// to world-drop — a plain release over the game view just keeps the item (no accidental loss).
import React, { useEffect, useState } from 'react';
import { useCursorStack } from '@/features/inventory-system/useCursorStack';

const btn: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, color: '#fff', border: '1.5px solid',
  borderRadius: 6, padding: '3px 8px', cursor: 'pointer', textShadow: '0 1px 1px #000',
  lineHeight: 1, userSelect: 'none',
};

export function DropToWorldGlobe({ onDrop }: { onDrop: () => Promise<boolean> }) {
  const cursor = useCursorStack((s) => s.cursor);
  const [phase, setPhase] = useState<'idle' | 'armed' | 'confirm'>('idle');

  // Carry ended (dropped elsewhere / ESC) → reset.
  useEffect(() => { if (!cursor) setPhase('idle'); }, [cursor]);

  if (!cursor) return null;   // only shown while carrying an item
  const armed = phase === 'armed';
  const confirming = phase === 'confirm';
  const topText = confirming ? 'CONFIRM?' : armed ? 'DROP TO WORLD' : ' ';

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: 20, alignSelf: 'center', userSelect: 'none' }}
      onPointerEnter={() => { if (!confirming) setPhase('armed'); }}
      onPointerLeave={() => { if (phase === 'armed') setPhase('idle'); }}
      onPointerUp={(e) => { if (confirming) return; e.stopPropagation(); setPhase('confirm'); }}
    >
      <style>{`@keyframes dtwPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      {/* Top text line ("DROP TO WORLD" → "CONFIRM?") */}
      <div style={{ height: 13, marginBottom: 3, fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: '#ff4d4d', textShadow: '0 1px 2px #000', whiteSpace: 'nowrap' }}>
        {topText}
      </div>
      {/* 60×60 box: the globe, or YES/NO when confirming */}
      <div style={{
        width: 60, height: 60, borderRadius: 'var(--hud-radius, 8px)',
        background: 'rgba(12,6,8,0.92)',
        border: `2px solid ${confirming || armed ? '#ff3a3a' : '#9a1f1f'}`,
        boxShadow: armed ? '0 0 12px rgba(255,58,58,0.8)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        transition: 'border 0.12s, box-shadow 0.12s',
      }}>
        {confirming ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void onDrop().then(() => setPhase('idle')); }} style={{ ...btn, background: '#1c7a32', borderColor: '#37d35f' }}>YES</button>
            <button onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPhase('idle'); }} style={{ ...btn, background: '#7a1c2a', borderColor: '#ff5a78' }}>NO</button>
          </div>
        ) : (
          <svg width="38" height="38" viewBox="0 0 24 24" style={{ animation: armed ? 'dtwPulse 0.5s infinite' : 'none' }} aria-label="Drop to world">
            <circle cx="12" cy="12" r="9" fill="none" stroke="#ff3a3a" strokeWidth="1.6" />
            <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="#ff3a3a" strokeWidth="1.3" />
            <line x1="3" y1="12" x2="21" y2="12" stroke="#ff3a3a" strokeWidth="1.3" />
            <line x1="5" y1="7.5" x2="19" y2="7.5" stroke="#ff3a3a" strokeWidth="1" />
            <line x1="5" y1="16.5" x2="19" y2="16.5" stroke="#ff3a3a" strokeWidth="1" />
          </svg>
        )}
      </div>
    </div>
  );
}
