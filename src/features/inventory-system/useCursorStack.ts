// Cursor-stack — the single piece of "what the mouse is carrying"
// state shared across the inventory UI. Tiny external store +
// useSyncExternalStore — no state-management dep, no re-render churn.
// Singleton: exactly one cursor exists at a time.
//
// Note: mouse-position state lives in CursorSprite as DOM-only state
// (no React re-renders on mousemove). Only the actual carried stack
// goes through this store.

import { useSyncExternalStore } from 'react';

export type CursorOrigin =
  | { region: 'inventory'; rowId: string; gridSlot: number; fullQuantity: number }
  | { region: 'hotbar'; slot: number }
  | { region: 'vault'; page: number; slot: number; fullQuantity: number };

export interface CursorStackPayload {
  itemId: string;
  itemKey: string;
  quantity: number;
  name: string;
  tier: number | null;
  spriteUrl: string | null;
  nonStackable: boolean;
  origin: CursorOrigin;
}

let _cursor: CursorStackPayload | null = null;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
function getCursor(): CursorStackPayload | null { return _cursor; }

export const cursorStackApi = {
  setCursor(c: CursorStackPayload | null) { _cursor = c; emit(); },
  takeFromCursor(n: number) {
    if (!_cursor) return;
    const next = _cursor.quantity - n;
    _cursor = next <= 0 ? null : { ..._cursor, quantity: next };
    emit();
  },
  addToCursor(n: number) {
    if (!_cursor) return;
    _cursor = { ..._cursor, quantity: _cursor.quantity + n };
    emit();
  },
  getCursor,
};

// Selector signature compatible with zustand-style usage. The two
// supported call shapes:
//   const cursor   = useCursorStack(s => s.cursor);
//   const setCursor = useCursorStack(s => s.setCursor);
export interface CursorStoreView {
  cursor: CursorStackPayload | null;
  setCursor: typeof cursorStackApi.setCursor;
  takeFromCursor: typeof cursorStackApi.takeFromCursor;
  addToCursor: typeof cursorStackApi.addToCursor;
}

// Build a stable "view" object: cursor changes when it changes, but
// the actions are always the same references on cursorStackApi.
// Memoized by current cursor identity so the view itself is stable
// across calls when the cursor hasn't changed.
let _viewCursor: CursorStackPayload | null = null;
let _view: CursorStoreView = freshView(null);
function freshView(c: CursorStackPayload | null): CursorStoreView {
  return {
    cursor: c,
    setCursor: cursorStackApi.setCursor,
    takeFromCursor: cursorStackApi.takeFromCursor,
    addToCursor: cursorStackApi.addToCursor,
  };
}
function getView(): CursorStoreView {
  const c = _cursor;
  if (c !== _viewCursor) {
    _viewCursor = c;
    _view = freshView(c);
  }
  return _view;
}

export function useCursorStack<T>(selector: (s: CursorStoreView) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getView()),
    () => selector(getView()),
  );
}
