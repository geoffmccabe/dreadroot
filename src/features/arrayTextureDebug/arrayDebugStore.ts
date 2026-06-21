// External store for the Stage-1 array-texture debug panel: open/close, latest stats,
// and a command seq the in-Canvas visualiser watches (load test tiles / stress / clear).
import { useSyncExternalStore } from 'react';
import type { ArrayTextureManagerStats } from '@/lib/arrayTextureManager';

interface Snapshot {
  open: boolean;
  stats: ArrayTextureManagerStats | null;
  seq: number;
  action: { type: 'load' | 'stress' | 'clear' | 'game'; n: number } | null;
}

let open = false;
let stats: ArrayTextureManagerStats | null = null;
let seq = 0;
let action: Snapshot['action'] = null;

// Cached snapshot — useSyncExternalStore needs a stable reference between changes.
let snapshot: Snapshot = { open, stats, seq, action };
const recompute = () => { snapshot = { open, stats, seq, action }; };

const subs = new Set<() => void>();
const emit = () => { recompute(); subs.forEach((f) => f()); };

export const arrayDebug = {
  isOpen: () => open,
  toggle: () => { open = !open; emit(); },
  setStats: (s: ArrayTextureManagerStats) => { stats = s; emit(); },
  dispatch: (type: 'load' | 'stress' | 'clear' | 'game', n = 0) => { action = { type, n }; seq++; emit(); },
  subscribe: (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; },
  getSnapshot: () => snapshot,
};

function subscribe(cb: () => void): () => void { return arrayDebug.subscribe(cb); }
export function useArrayDebug(): Snapshot {
  return useSyncExternalStore(subscribe, arrayDebug.getSnapshot, arrayDebug.getSnapshot);
}
