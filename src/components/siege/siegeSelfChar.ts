// siegeSelfChar — which of the 6 characters the player's own self-avatar is (for testing all of them).
// Armed with '*' then 1-6 (see SiegeSelfAvatar). Index into LINEUP_CHARS. Defaults to Rajax (#5).
import { useSyncExternalStore } from 'react';

let index = 4;   // LINEUP_CHARS order: Ash Thorn Dago Jankz Rajax Fluffer → 4 = Rajax
let version = 0;
const subs = new Set<() => void>();

export const getSelfCharIndex = (): number => index;
export function setSelfCharIndex(i: number): void {
  if (i < 0 || i > 5 || i === index) return;
  index = i; version++; subs.forEach((f) => f());
}
export function useSelfCharIndex(): number {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => index, () => index);
}
