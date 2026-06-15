/**
 * NpcSystem — DOM-side mount for the new NPC system: registers the built-in EMS
 * NPCs, owns the Ctrl/Cmd-N panel toggle, and the `@`-then-digit spawn command.
 * Renders the near-full-page NpcPanel. The in-canvas EMSRenderer is mounted
 * separately in FortressScene; both talk to the shared npcManager.
 *
 * Fully parallel to the legacy enemy/friend systems — adding this touches nothing
 * in the old path.
 */
import { useEffect, useState, useRef, type ReactElement } from 'react';
import { registerBuiltinNpcs } from './definitions';
import { npcManager } from './NpcManager';
import { spawnNpcInFrontOfPlayer } from './spawnNpc';
import { NpcPanel } from './panel/NpcPanel';

const AT_SEQUENCE_TIMEOUT_MS = 2000;

export function NpcSystem({ isAdmin }: { isAdmin: boolean }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const atActiveRef = useRef<number>(0); // timestamp of the '@' press; 0 = idle

  useEffect(() => { registerBuiltinNpcs(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Ctrl/Cmd-N → toggle the NPC builder (admin only).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        if (!isAdmin) return;
        e.preventDefault();
        setOpen((o) => {
          const next = !o;
          // Free the mouse from FPS pointer-lock so the panel is clickable.
          if (next) document.exitPointerLock?.();
          return next;
        });
        return;
      }
      if (e.key === 'Escape' && open) { setOpen(false); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // '@' then a digit (1-9) → spawn the Nth NPC definition in front of you.
      const now = Date.now();
      if (atActiveRef.current && now - atActiveRef.current > AT_SEQUENCE_TIMEOUT_MS) {
        atActiveRef.current = 0;
      }
      if (atActiveRef.current === 0) {
        if (e.key === '@') {
          if (!isAdmin) return;
          atActiveRef.current = now;
        }
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const defs = npcManager.getDefinitions();
        if (idx < defs.length) spawnNpcInFrontOfPlayer(defs[idx].slug);
        atActiveRef.current = 0;
        return;
      }
      atActiveRef.current = 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isAdmin]);

  if (!open) return null;
  return <NpcPanel onClose={() => setOpen(false)} />;
}
