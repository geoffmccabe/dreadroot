// The input-agnostic editor core. ALL edits go through these command functions —
// the mouse, the keyboard, and (later) the VR controller never touch an object
// directly, they call addObject/transformObject/duplicate/deleteObject. That single
// rule is what lets a Rift driver slot in later without a rewrite. Every mutating
// command is paired with its inverse and pushed onto an undo stack, and mirrored to
// Supabase via persistence.ts.
import { useSyncExternalStore } from 'react';
import type { WorldObject, TRS } from './types';
import { trsOf } from './types';
import { insertObject, persistTransform, deleteObject } from './persistence';

interface HistoryEntry { undo: () => void; redo: () => void; }

interface State {
  game: string;
  worldId: string;
  objects: WorldObject[];        // stable ref; replaced only on change
  selectedId: string | null;
  editMode: boolean;
  canEdit: boolean;
}

const state: State = {
  game: '', worldId: '', objects: [], selectedId: null, editMode: false, canEdit: false,
};
const past: HistoryEntry[] = [];
const future: HistoryEntry[] = [];

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

// --- context / loading (no history) ---
export function setContext(game: string, worldId: string, objects: WorldObject[]): void {
  state.game = game; state.worldId = worldId;
  state.objects = objects; state.selectedId = null;
  past.length = 0; future.length = 0;
  emit();
}
export function setCanEdit(v: boolean): void { if (state.canEdit !== v) { state.canEdit = v; emit(); } }

// --- selection / mode (no history) ---
export function setSelected(id: string | null): void { if (state.selectedId !== id) { state.selectedId = id; emit(); } }
export function toggleEditMode(): void {
  if (!state.canEdit) return;
  state.editMode = !state.editMode;
  if (!state.editMode) state.selectedId = null;
  emit();
}

// --- local mutators (pure list ops, no history, no persistence) ---
function localAdd(o: WorldObject): void { state.objects = [...state.objects, o]; emit(); }
function localRemove(id: string): void {
  state.objects = state.objects.filter((o) => o.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  emit();
}
function localSetTRS(id: string, t: TRS): void {
  state.objects = state.objects.map((o) => (o.id === id ? { ...o, pos: t.pos, quat: t.quat, scale: t.scale } : o));
  emit();
}

function pushHistory(e: HistoryEntry): void { past.push(e); future.length = 0; }

// --- commands (history + persistence) ---
export function addObject(o: WorldObject): void {
  const { game, worldId } = state;
  localAdd(o); insertObject(game, worldId, o);
  pushHistory({
    undo: () => { localRemove(o.id); deleteObject(o.id); },
    redo: () => { localAdd(o); insertObject(game, worldId, o); },
  });
}

export function deleteSelected(): void {
  const o = current(); if (!o) return;
  const { game, worldId } = state;
  localRemove(o.id); deleteObject(o.id);
  pushHistory({
    undo: () => { localAdd(o); insertObject(game, worldId, o); },
    redo: () => { localRemove(o.id); deleteObject(o.id); },
  });
}

// Move/rotate/scale the selected object. prev is captured before the change so the
// inverse is exact. Each call is one undo step (fine for Phase 0's keyboard nudges).
export function transformSelected(next: TRS): void {
  const o = current(); if (!o) return;
  const id = o.id;
  const prev = trsOf(o);
  localSetTRS(id, next); persistTransform(id, next);
  pushHistory({
    undo: () => { localSetTRS(id, prev); persistTransform(id, prev); },
    redo: () => { localSetTRS(id, next); persistTransform(id, next); },
  });
}

export function duplicateSelected(offset: [number, number, number]): void {
  const o = current(); if (!o) return;
  const copy: WorldObject = {
    ...o, id: crypto.randomUUID(),
    pos: [o.pos[0] + offset[0], o.pos[1] + offset[1], o.pos[2] + offset[2]],
  };
  addObject(copy);
  setSelected(copy.id);
}

export function undo(): void { const e = past.pop(); if (!e) return; e.undo(); future.push(e); }
export function redo(): void { const e = future.pop(); if (!e) return; e.redo(); past.push(e); }

// --- reads ---
export function current(): WorldObject | null {
  return state.selectedId ? state.objects.find((o) => o.id === state.selectedId) ?? null : null;
}

export const useEditorObjects = () => useSyncExternalStore(subscribe, () => state.objects);
export const useSelectedId = () => useSyncExternalStore(subscribe, () => state.selectedId);
export const useEditMode = () => useSyncExternalStore(subscribe, () => state.editMode);
export const getEditMode = () => state.editMode;
export const getCanEdit = () => state.canEdit;
