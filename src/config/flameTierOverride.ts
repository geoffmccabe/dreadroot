// Superadmin flame-glove tier OVERRIDE (testing only). When set, the live flame uses this tier
// for its colors / range / damage instead of the equipped glove's real tier. Driven by the
// "#F<digit>" cheat (FlameTierCheat.tsx); cleared automatically when the glove is unequipped.
// null = no override (use the equipped glove's actual tier).
import { useSyncExternalStore } from 'react';

let override: number | null = null;
const subs = new Set<() => void>();

export function getFlameTierOverride(): number | null { return override; }

export function setFlameTierOverride(n: number | null): void {
  if (n === override) return;
  override = n;
  subs.forEach((f) => f());
}

export function useFlameTierOverride(): number | null {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getFlameTierOverride,
    getFlameTierOverride,
  );
}
