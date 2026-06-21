// Global shadow toggle (the '-' / '_' key flips it). Drives the Canvas shadow map +
// which lights cast. Default OFF so there's zero shadow cost until you turn it on to
// measure the FPS impact. External store so both the DOM key handler and in-Canvas
// light components can read it across the R3F boundary.
import { useSyncExternalStore } from 'react';

let enabled = false;
const listeners = new Set<() => void>();

export const shadowStore = {
  get: (): boolean => enabled,
  toggle: () => { enabled = !enabled; listeners.forEach((l) => l()); },
  set: (v: boolean) => { if (v !== enabled) { enabled = v; listeners.forEach((l) => l()); } },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};

export function useShadowsEnabled(): boolean {
  return useSyncExternalStore(shadowStore.subscribe, shadowStore.get, shadowStore.get);
}
