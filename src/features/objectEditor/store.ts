// The input-agnostic editor core. ALL edits go through these command functions —
// the mouse, the keyboard, and (later) the VR controller never touch an object
// directly, they call addObject/transformObject/duplicate/deleteObject. That single
// rule is what lets a Rift driver slot in later without a rewrite. Every mutating
// command is paired with its inverse and pushed onto an undo stack, and mirrored to
// Supabase via persistence.ts.
import { useSyncExternalStore } from 'react';
import type { WorldObject, TRS, BakedRef } from './types';
import { trsOf } from './types';
import { insertObject, persistTransform, deleteObject, persistMeta } from './persistence';
import type { FloodData } from './floodFill';
import { applyBakedTransform, liveBakedTransform, hideBaked } from './bakedOverrides';
import { updateObject as updateBuilderObject, removeObject as removeBuilderObject } from '@/components/siege/builder/builderObjectsState';

// Builder objects store a single yaw + uniform scale; extract them from the Arrange tool's quat/Vec3.
const yawOf = (q: [number, number, number, number]) => 2 * Math.atan2(q[1], q[3]);
function writeBuilder(id: string, t: TRS): void {
  updateBuilderObject(id, { pos: t.pos, rotY: yawOf(t.quat), scale: t.scale[0] });
}

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
/** Set edit mode explicitly (idempotent). Lets the Model Placer's ON switch drive Arrange too, so
 *  there is ONE build switch rather than two modes the user has to discover separately. */
export function setEditMode(v: boolean): void {
  if (state.editMode !== v) toggleEditMode();
}

export function toggleEditMode(): void {
  if (!state.canEdit) return;
  state.editMode = !state.editMode;
  if (!state.editMode) { state.selectedId = null; state.objects = state.objects.filter((o) => !o.baked && !o.external && !o.builder); }
  emit();
}

// Register a transient "external" editable — a live scene object (e.g. a weapon on a hand bone) that
// flows through the SAME panel / transform controls / undo, but persists NOWHERE (a bridge applies
// its transform to the real object and reads back the bakeable numbers). Idempotent by id.
export function registerExternal(o: WorldObject): void {
  if (state.objects.some((x) => x.id === o.id)) return;
  state.objects = [...state.objects, { ...o, external: true }];
  emit();
}
export function removeExternal(id: string): void {
  if (!state.objects.some((x) => x.id === id)) return;
  state.objects = state.objects.filter((x) => x.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  emit();
}

// Select a baked map instance (e.g. an Enchanted Forest cliff) as a temporary editable object,
// so it flows through the SAME panel / transform keys / undo as a normal object. Only one baked
// selection at a time; it isn't a DB row (its edits persist via the override store).
export function selectBaked(ref: BakedRef, t: TRS): void {
  const id = `baked:${ref.key}`;
  state.objects = [...state.objects.filter((o) => !o.baked), { id, modelUrl: `baked:${ref.fbx}`, pos: t.pos, quat: t.quat, scale: t.scale, baked: ref }];
  state.selectedId = id;
  emit();
}
export function clearBaked(): void {
  if (state.objects.some((o) => o.baked)) {
    state.objects = state.objects.filter((o) => !o.baked);
    if (state.selectedId?.startsWith('baked:')) state.selectedId = null;
    emit();
  }
}

// Select a builder-placed object as a temporary editable, so the Arrange grab-and-carry / wheel /
// rotate / scale drive it too — writing back to builderObjectsState. One builder selection at a time.
export function selectBuilder(id: string, t: TRS): void {
  const tid = `builder:${id}`;
  state.objects = [...state.objects.filter((o) => !o.builder), { id: tid, modelUrl: `builder:${id}`, pos: t.pos, quat: t.quat, scale: t.scale, builder: { id } }];
  state.selectedId = tid;
  emit();
}
export function clearBuilder(): void {
  if (state.objects.some((o) => o.builder)) {
    state.objects = state.objects.filter((o) => !o.builder);
    if (state.selectedId?.startsWith('builder:')) state.selectedId = null;
    emit();
  }
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

// Attach (or clear) a shore-seeking flood footprint on a water object. Not on the undo stack —
// re-flooding is a deliberate recompute, and Ctrl-Z on a flood would be confusing; press F again
// to reshape. Persists via the object's `meta` jsonb so the pool shape is shared with everyone.
export function setObjectFlood(id: string, flood: FloodData | undefined): void {
  let changed = false;
  state.objects = state.objects.map((o) => {
    if (o.id !== id) return o;
    changed = true;
    const next = { ...o }; if (flood) next.flood = flood; else delete next.flood;
    return next;
  });
  if (!changed) return;
  emit();
  persistMeta(id, { flood: flood ?? null });
}

export function deleteSelected(): void {
  const o = current(); if (!o) return;
  if (o.external) { removeExternal(o.id); return; }   // can't delete a live weapon — just deselect it
  if (o.builder) { const bid = o.builder.id; localRemove(o.id); removeBuilderObject(bid); return; }
  if (o.baked) {
    const baked = o.baked; const trs = trsOf(o);
    localRemove(o.id); hideBaked(baked);
    pushHistory({
      undo: () => { localAdd(o); applyBakedTransform(baked, trs); setSelected(o.id); },
      redo: () => { localRemove(o.id); hideBaked(baked); },
    });
    return;
  }
  const { game, worldId } = state;
  localRemove(o.id); deleteObject(o.id);
  pushHistory({
    undo: () => { localAdd(o); insertObject(game, worldId, o); },
    redo: () => { localRemove(o.id); deleteObject(o.id); },
  });
}

// Persist a transform: baked map instances go to the override store (+ live update); DB-backed
// objects go to Supabase. The local list update is the same for both.
function persistTRS(o: WorldObject, t: TRS): void {
  if (o.external) return;            // transient live editable — the bridge reads its TRS; no DB/override
  if (o.builder) { writeBuilder(o.builder.id, t); return; }
  if (o.baked) applyBakedTransform(o.baked, t);
  else persistTransform(o.id, t);
}

/**
 * Yaw the selection by `rad`. Exposed so the Model Placer's [ and ] keys can drive the SAME
 * selection as Arrange, instead of each tool keeping its own idea of "the selected thing".
 * Quaternion premultiply written out longhand to keep this module free of a three.js import.
 */
export function rotateSelectedYaw(rad: number): void {
  const o = current(); if (!o) return;
  const t = trsOf(o);
  const [x, y, z, w] = t.quat;
  const c = Math.cos(rad / 2), sn = Math.sin(rad / 2);
  transformSelected({ pos: t.pos, scale: t.scale, quat: [c * x + sn * z, c * y + sn * w, c * z - sn * x, c * w - sn * y] });
}

/** Scale the selection uniformly by `f`, for the placer's - and = keys. */
export function scaleSelectedBy(f: number): void {
  const o = current(); if (!o) return;
  const t = trsOf(o);
  const cl = (v: number) => Math.min(50, Math.max(0.05, v * f));
  transformSelected({ pos: t.pos, quat: t.quat, scale: [cl(t.scale[0]), cl(t.scale[1]), cl(t.scale[2])] });
}

// Move/rotate/scale the selected object. prev is captured before the change so the
// inverse is exact. Each call is one undo step (fine for Phase 0's keyboard nudges).
export function transformSelected(next: TRS): void {
  const o = current(); if (!o) return;
  const id = o.id;
  const prev = trsOf(o);
  localSetTRS(id, next); persistTRS(o, next);
  pushHistory({
    undo: () => { localSetTRS(id, prev); persistTRS(o, prev); },
    redo: () => { localSetTRS(id, next); persistTRS(o, next); },
  });
}

// --- live drag (one undo step + one save per whole drag) ---
// A grab-and-carry drag calls dragBegin() once, dragTo() every frame (visual only, no DB / no
// localStorage), and dragCommit() on release (persist once + push a single history entry for the
// net move). This keeps a continuous drag from spamming Supabase / localStorage 60×/sec.
let dragId: string | null = null;
let dragPrev: TRS | null = null;

export function dragBegin(): void {
  const o = current(); if (!o) { dragId = null; dragPrev = null; return; }
  dragId = o.id; dragPrev = trsOf(o);
}

export function dragTo(next: TRS): void {
  if (!dragId) return;
  const o = state.objects.find((x) => x.id === dragId); if (!o) return;
  localSetTRS(dragId, next);
  if (o.builder) writeBuilder(o.builder.id, next);  // move the builder object live
  else if (o.baked) liveBakedTransform(o.baked, next);   // visual only; not saved until commit
}

export function dragCommit(): void {
  const id = dragId, prev = dragPrev; dragId = null; dragPrev = null;
  if (!id || !prev) return;
  const o = state.objects.find((x) => x.id === id); if (!o) return;
  const next = trsOf(o);
  const moved = prev.pos.some((v, i) => v !== next.pos[i]) ||
    prev.quat.some((v, i) => v !== next.quat[i]) ||
    prev.scale.some((v, i) => v !== next.scale[i]);
  if (!moved) return;
  persistTRS(o, next);
  pushHistory({
    undo: () => { localSetTRS(id, prev); persistTRS(o, prev); },
    redo: () => { localSetTRS(id, next); persistTRS(o, next); },
  });
}

// Abort a drag in progress (Esc): snap the object back to where the grab started, no history.
export function dragCancel(): void {
  const id = dragId, prev = dragPrev; dragId = null; dragPrev = null;
  if (!id || !prev) return;
  const o = state.objects.find((x) => x.id === id); if (!o) return;
  localSetTRS(id, prev);
  if (o.builder) writeBuilder(o.builder.id, prev);
  else if (o.baked) liveBakedTransform(o.baked, prev);
}

// True while a grab-and-carry drag is in progress (used by the controller's frame loop).
export function isDragging(): boolean { return dragId !== null; }

export function duplicateSelected(offset: [number, number, number]): void {
  const o = current(); if (!o) return;
  if (o.baked || o.external) return;   // duplicating a baked instance / live weapon isn't supported
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
export const useCanEdit = () => useSyncExternalStore(subscribe, () => state.canEdit);
// Live selected object — re-renders when it's moved/rotated/scaled (each edit replaces
// the object ref) or when the selection changes. null when nothing is selected.
export const useCurrent = () => useSyncExternalStore(subscribe, current);
export const getEditMode = () => state.editMode;
export const getCanEdit = () => state.canEdit;
