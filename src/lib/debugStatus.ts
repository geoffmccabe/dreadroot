// Tiny global one-line status string for in-HUD diagnostics that
// shouldn't be toasts. Subscribe via useDebugStatus() in any HUD
// component; update via setDebugStatus(s) from anywhere.
//
// Cleared by passing an empty string. Persists across renders.

import { useSyncExternalStore } from 'react';

let _status = '';
const _listeners = new Set<() => void>();

export function setDebugStatus(s: string): void {
  if (_status === s) return;
  _status = s;
  _listeners.forEach((l) => l());
}

export function useDebugStatus(): string {
  return useSyncExternalStore(
    (cb) => {
      _listeners.add(cb);
      return () => { _listeners.delete(cb); };
    },
    () => _status,
    () => '',
  );
}
