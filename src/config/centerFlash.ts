// A brief centered on-screen message (e.g. "NO WEAPON EQUIPPED"). flashCenter()
// re-triggers it each call; CenterFlash renders + fades it. Module store so any
// code (the fire path) can flash without prop-threading.
import { useSyncExternalStore } from 'react';

let snap = { msg: '', at: 0 };
const subs = new Set<() => void>();

export function flashCenter(text: string): void {
  snap = { msg: text, at: performance.now() };
  subs.forEach((s) => s());
}

export function useCenterFlash(): { msg: string; at: number } {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => snap, () => snap,
  );
}
