// ChatOverlay — the in-game chat UI (message log + input box).
//
// Open with T, Enter, or "/" (the last prefills a slash for commands). Opening
// focuses the input, which auto-disables game keys (FortressControls already
// ignores keys while a text field is focused) and releases pointer-lock so the
// cursor works; Enter sends, Esc cancels, and closing re-locks for mouse-look.
// When closed, recent messages linger then fade out.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChatMessage } from './types';

const FADE_MS = 8000;        // how long a message shows in the closed log
const SHOWN_OPEN = 12;       // lines visible while typing
const SHOWN_CLOSED = 8;      // lines visible in the faded log
// Theme tokens so this file is IDENTICAL across games — the dark panel is pink in
// Pinkland, blue in DreadRoot, driven by --panel-bg-strong-h per game.
const PANEL_BG = 'hsl(var(--panel-bg-strong-h) / 0.85)';
const PANEL_BORDER = 'hsl(var(--panel-border-strong-h) / 0.55)';

export function ChatOverlay({ messages, onSend }: {
  messages: ChatMessage[];
  onSend: (body: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  // Open on T / Enter / Slash when the game (not another text field) has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let prefill: string | null = null;
      if (e.code === 'KeyT' || e.code === 'Enter' || e.code === 'NumpadEnter') prefill = '';
      else if (e.code === 'Slash') prefill = '/';
      else return;
      e.preventDefault();
      try { document.exitPointerLock?.(); } catch { /* not locked */ }
      setDraft(prefill);
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus the input the frame after it mounts.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Tick once a second so the closed log fades.
  useEffect(() => {
    if (open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setDraft('');
    // Re-acquire pointer-lock to resume mouse-look (Enter/Esc is a user gesture).
    try { document.querySelector('canvas')?.requestPointerLock?.(); } catch { /* ignore */ }
  }, []);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (draft.trim()) onSend(draft);
      close();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const shown = open
    ? messages.slice(-SHOWN_OPEN)
    : messages.filter((m) => now - m.ts < FADE_MS).slice(-SHOWN_CLOSED);

  // Group consecutive messages from the same speaker so the name shows ONCE and
  // their lines stack beneath it in one panel — far less cluttered than a box per line.
  const groups: { id: string; userId: string; username: string; color?: string; lines: string[]; ts: number }[] = [];
  for (const m of shown) {
    const last = groups[groups.length - 1];
    if (last && last.userId === m.userId) { last.lines.push(m.body); last.ts = m.ts; }
    else groups.push({ id: m.id, userId: m.userId, username: m.username, color: m.color, lines: [m.body], ts: m.ts });
  }

  if (!open && groups.length === 0) return null;

  return (
    <div
      style={{
        // Span from the user panel's left edge (16px) to the 6th hotbar square's
        // right edge. Hotbar is 6×60 + 5×10 = 410px wide, centered → its right
        // edge is at viewport-center + 205px, i.e. right: calc(50% - 205px).
        // Sits above the bottom HUD row (60px tall at bottom:16px → top 76px).
        position: 'fixed', left: 16, right: 'calc(50% - 205px)', bottom: 84, zIndex: 60,
        pointerEvents: open ? 'auto' : 'none', fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: open ? 6 : 0 }}>
        {groups.map((g) => (
          <div
            key={g.id}
            style={{
              background: open ? PANEL_BG : 'transparent',
              border: open ? `1px solid ${PANEL_BORDER}` : 'none',
              borderRadius: 6,
              padding: open ? '4px 8px' : '0 2px',
              opacity: open ? 1 : Math.max(0.12, 1 - (now - g.ts) / FADE_MS),
            }}
          >
            <div style={{ fontSize: 13, lineHeight: 1.4, fontWeight: 600, color: g.color || '#ff8fd0', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>
              {g.username}
            </div>
            {g.lines.map((line, i) => (
              <div key={i} style={{ fontSize: 13, lineHeight: 1.4, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>
      {open && (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKeyDown}
          onBlur={close}
          maxLength={240}
          placeholder="Press Enter to send, Esc to cancel"
          style={{
            width: '100%', padding: '6px 10px', fontSize: 14,
            color: '#fff', background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`, borderRadius: 6, outline: 'none',
          }}
        />
      )}
    </div>
  );
}
