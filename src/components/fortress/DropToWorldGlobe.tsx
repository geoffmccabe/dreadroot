// Drop-to-world target. ABSOLUTELY positioned a half-slot to the RIGHT of the last QA
// slot (so it never shifts the hotbar layout), visible only while an item is on the cursor
// (carried between Inventory / QA / Equip / Vault). Flow: hover the held item over the globe
// → it flashes + shows "DROP TO WORLD". Release over it → "CONFIRM?" replaces that text and
// YES/NO buttons replace the globe. YES drops the item into the world; NO cancels. This is
// the ONLY way to world-drop — a plain release over the game view just keeps the item.
import React, { useEffect, useState } from 'react';
import { useCursorStack } from '@/features/inventory-system/useCursorStack';

const btn: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, color: '#fff', border: '1.5px solid',
  borderRadius: 5, padding: '4px 7px', cursor: 'pointer', textShadow: '0 1px 1px #000',
  lineHeight: 1, userSelect: 'none', fontFamily: 'var(--hud-font)',
};

export function DropToWorldGlobe({ onDrop }: { onDrop: () => Promise<boolean> }) {
  const cursor = useCursorStack((s) => s.cursor);
  const [phase, setPhase] = useState<'idle' | 'armed' | 'confirm'>('idle');

  // Carry ended (dropped elsewhere / ESC) → reset.
  useEffect(() => { if (!cursor) setPhase('idle'); }, [cursor]);

  if (!cursor) return null;   // only shown while carrying an item
  const armed = phase === 'armed';
  const confirming = phase === 'confirm';
  const topText = confirming ? 'CONFIRM?' : armed ? 'DROP TO WORLD' : '';

  return (
    <div
      title="Drop this item into the world"
      // Absolute → does NOT take part in the hotbar flex flow, so the slots never move.
      style={{ position: 'absolute', left: '100%', top: 0, marginLeft: 30, width: 60, height: 60, userSelect: 'none', fontFamily: 'var(--hud-font)' }}
      onPointerEnter={() => { if (!confirming) setPhase('armed'); }}
      onPointerLeave={() => { if (phase === 'armed') setPhase('idle'); }}
      onPointerUp={(e) => { if (confirming) return; e.stopPropagation(); setPhase('confirm'); }}
    >
      <style>{`@keyframes dtwPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      {/* Warning text floats ABOVE the box (absolute) so it never changes alignment. */}
      <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: '50%', transform: 'translateX(-50%)', fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: 'hsl(var(--destructive))', textShadow: '0 1px 3px #000', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        {topText}
      </div>
      {/* The box: globe icon, or YES/NO when confirming. Same size/radius as a QA slot. */}
      <div style={{
        width: 60, height: 60, borderRadius: 'var(--hud-radius)',
        background: 'hsl(211 30% 8% / 0.9)',
        border: `2px solid hsl(var(--destructive) / ${confirming || armed ? 1 : 0.5})`,
        boxShadow: armed ? '0 0 12px hsl(var(--destructive) / 0.8)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(8px) saturate(140%)', WebkitBackdropFilter: 'blur(8px) saturate(140%)',
        transition: 'border 0.12s, box-shadow 0.12s',
      }}>
        {confirming ? (
          <div style={{ display: 'flex', gap: 5 }}>
            {/* YES = the destructive confirm → game danger red. NO = neutral cancel. */}
            <button onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void onDrop().then(() => setPhase('idle')); }}
              style={{ ...btn, background: 'hsl(var(--destructive))', borderColor: 'hsl(var(--destructive))' }}>YES</button>
            <button onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPhase('armed'); }}
              style={{ ...btn, background: 'hsl(211 18% 30%)', borderColor: 'hsl(211 18% 48%)' }}>NO</button>
          </div>
        ) : (
          <svg width="38" height="38" viewBox="0 0 24 24" style={{ animation: armed ? 'dtwPulse 0.5s infinite' : 'none' }} aria-label="Drop to world">
            <circle cx="12" cy="12" r="9" fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.6" />
            <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.3" />
            <line x1="3" y1="12" x2="21" y2="12" stroke="hsl(var(--destructive))" strokeWidth="1.3" />
            <line x1="5" y1="7.5" x2="19" y2="7.5" stroke="hsl(var(--destructive))" strokeWidth="1" />
            <line x1="5" y1="16.5" x2="19" y2="16.5" stroke="hsl(var(--destructive))" strokeWidth="1" />
          </svg>
        )}
      </div>
    </div>
  );
}
