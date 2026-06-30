// Baked-instance transform overrides. The Enchanted Forest objects (cliffs, trees, …) are
// drawn as batched instances from placements.json — not DB rows. To let the Arrange tool move
// them, we record just the EDITS: per original-position key, a replacement placement matrix
// (or a hide flag). WorldObjectsLayer reads this map when it builds each batch, so edits
// survive streaming rebuilds; here we also live-update the instance so the move is immediate.
// Mirrors the collider-override pattern (keyed by rounded position, localStorage-backed).
import * as THREE from 'three';
import type { TRS, BakedRef } from './types';
import { fetchEdits, foldEdits, appendEdits } from './overridesDb';

export interface XformOverride { matrix?: number[]; hide?: boolean }

export const transformOverrides = new Map<string, XformOverride>();

// ── shared-DB save state ──────────────────────────────────────────────────────────────────────
// `dirty` = edits made since the last publish (Ctrl-S / Save button). localStorage is the instant
// working draft; publishing appends these to the shared history table (overridesDb).
const dirty = new Map<string, XformOverride>();
let saveGame = '';
let saveState = { dirty: 0, saving: false, savedAt: 0, error: false };
const saveSubs = new Set<() => void>();
export function subscribeSave(cb: () => void): () => void { saveSubs.add(cb); return () => { saveSubs.delete(cb); }; }
export function getSaveState(): typeof saveState { return saveState; }
function emitSave(patch: Partial<typeof saveState>): void { saveState = { ...saveState, dirty: dirty.size, ...patch }; saveSubs.forEach((f) => f()); }
function markDirty(key: string): void { const ov = transformOverrides.get(key); if (ov) { dirty.set(key, ov); emitSave({}); } }

// Stable key: model + rounded ORIGINAL world position (incl. Y so stacked objects don't collide).
export function placeKey(fbx: string, x: number, y: number, z: number): string {
  return `${fbx}@${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
}

// ── per-world persistence (localStorage for now; DB is the next hardening step) ──
let world = '';
const lsKey = () => `sw_xform_ov::${world}`;

export function setWorldOverrides(worldId: string): void {
  if (worldId === world) return;
  world = worldId;
  transformOverrides.clear();
  dirty.clear();
  try {
    const raw = localStorage.getItem(lsKey());
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, XformOverride>)) transformOverrides.set(k, v);
  } catch { /* ignore */ }
  emitSave({ savedAt: 0, error: false });
}

function save(): void {
  try { localStorage.setItem(lsKey(), JSON.stringify(Object.fromEntries(transformOverrides))); } catch { /* ignore */ }
}

// Pull the shared history from Supabase and fold it into the current map. Any local-only edit that
// was never published is preserved AND flagged dirty, so existing localStorage work isn't lost — it
// just shows as "unsaved" until the next publish. Call right after setWorldOverrides on world enter.
export async function loadWorldFromDb(game: string, worldId: string): Promise<void> {
  saveGame = game;
  const rows = await fetchEdits(game, worldId);
  if (worldId !== world) return;                 // world changed while we were fetching
  const dbFold = foldEdits(rows);
  for (const [k, v] of transformOverrides) if (!dbFold.has(k)) dirty.set(k, v);  // unpublished local work
  transformOverrides.clear();
  for (const [k, v] of dbFold) transformOverrides.set(k, v);
  for (const [k, v] of dirty) transformOverrides.set(k, v);                       // local unsaved overlays DB
  save();
  emitSave({});
}

// Publish all dirty edits to the shared append-only history. Returns false on failure (UI flags it).
export async function saveWorldToDb(): Promise<boolean> {
  if (!dirty.size) return true;
  emitSave({ saving: true, error: false });
  const edits = [...dirty.entries()].map(([key, ov]) => ({ key, ov }));
  const ok = await appendEdits(saveGame, world, edits);
  if (ok) { dirty.clear(); emitSave({ saving: false, savedAt: Date.now(), error: false }); }
  else emitSave({ saving: false, error: true });
  return ok;
}

// ── live application ──
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _place = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

function liveSet(ref: BakedRef, m: THREE.Matrix4): void {
  const im = ref.mesh;
  if (im && ref.instanceId >= 0 && ref.instanceId < im.count) {
    im.setMatrixAt(ref.instanceId, m);
    im.instanceMatrix.needsUpdate = true;
  }
}

// Move/rotate/scale a baked instance: store the new placement matrix + update it on screen now.
export function applyBakedTransform(ref: BakedRef, t: TRS): void {
  bakedTransform(ref, t, true);
}

// Live (per-frame drag) version: update the in-memory override + the on-screen matrix, but DON'T
// touch localStorage. The drag's final position is saved once on release via applyBakedTransform.
export function liveBakedTransform(ref: BakedRef, t: TRS): void {
  bakedTransform(ref, t, false);
}

function bakedTransform(ref: BakedRef, t: TRS, persist: boolean): void {
  _p.set(t.pos[0], t.pos[1], t.pos[2]);
  _q.set(t.quat[0], t.quat[1], t.quat[2], t.quat[3]);
  _s.set(t.scale[0], t.scale[1], t.scale[2]);
  _place.compose(_p, _q, _s);
  transformOverrides.set(ref.key, { matrix: _place.toArray() });
  if (persist) { save(); markDirty(ref.key); }
  _local.fromArray(ref.localArr);
  _m.multiplyMatrices(_place, _local);
  liveSet(ref, _m);
}

// "Delete" a baked instance = hide it (zero scale). Reversible via applyBakedTransform (undo).
export function hideBaked(ref: BakedRef): void {
  const prev = transformOverrides.get(ref.key);
  transformOverrides.set(ref.key, { ...prev, hide: true });
  save(); markDirty(ref.key);
  liveSet(ref, _zero);
}
