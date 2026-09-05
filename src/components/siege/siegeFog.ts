// siegeFog — a tiny on/off switch for the Bleakrock horror fog + scrim, so it can be turned off
// from the Admin/Weather panel (e.g. to fly out and inspect distant objects). Default ON.
import { useSyncExternalStore } from 'react';

let fogOn = true;
const subs = new Set<() => void>();
export const getSiegeFog = (): boolean => fogOn;
export const setSiegeFog = (v: boolean): void => { if (v === fogOn) return; fogOn = v; subs.forEach((f) => f()); };
export function useSiegeFog(): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getSiegeFog, getSiegeFog);
}

/**
 * Cmd-F (Ctrl-F) toggles the fog off and on. Flying over generated terrain to judge its shape is
 * impossible through SWW's fog, so this is a testing convenience, not a gameplay feature.
 *
 * The browser's own find bar is suppressed while the game has focus, which is the trade for using a
 * key that is easy to remember. Typing in a panel field is left alone.
 *
 * Idempotent: safe to call from any mounting component.
 */
let fogHotkeyInstalled = false;
export function installFogHotkey(): () => void {
  if (fogHotkeyInstalled) return () => {};
  fogHotkeyInstalled = true;
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyF' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    setSiegeFog(!getSiegeFog());
  };
  window.addEventListener('keydown', onKey, true);
  return () => { window.removeEventListener('keydown', onKey, true); fogHotkeyInstalled = false; };
}
