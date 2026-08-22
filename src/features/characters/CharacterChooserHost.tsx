/**
 * Owns the chooser's open state and the Opt+Cmd+1..9 shortcuts.
 *
 * Mounted once. The open state lives in a tiny module store rather than React
 * context so anything (the user panel, a shortcut, the console) can open it
 * without threading props through the HUD.
 */
import { useEffect, useState } from 'react';
import { CharacterChooserModal } from './CharacterChooserModal';
import { DREADROOT_CHARACTERS } from './dreadrootCharacters';
import { selectCharacterByIndex } from './characterSelection';

const subs = new Set<(v: boolean) => void>();
let openState = false;

export function openCharacterChooser(): void {
  openState = true;
  subs.forEach((f) => f(true));
  // Release the pointer lock or the modal cannot be clicked.
  if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
}
export function closeCharacterChooser(): void {
  openState = false;
  subs.forEach((f) => f(false));
}

export function CharacterChooserHost(): JSX.Element {
  const [open, setOpen] = useState(openState);

  useEffect(() => {
    const fn = (v: boolean) => setOpen(v);
    subs.add(fn);
    return () => { subs.delete(fn); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Opt+Cmd+1..9 picks a character directly and shows it. Uses e.code so
      // the digit is identified regardless of what Option does to e.key on a
      // Mac (Opt+1 produces "¡", not "1").
      if (!e.altKey || !e.metaKey) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (!m) return;
      e.preventDefault();
      const i = Number(m[1]) - 1;
      if (i >= DREADROOT_CHARACTERS.length) return;
      selectCharacterByIndex(i);
      openCharacterChooser();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <CharacterChooserModal
      open={open}
      onOpenChange={(v) => { openState = v; setOpen(v); }}
    />
  );
}
