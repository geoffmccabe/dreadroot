// builderObjectsState — the placed-object store for the in-world drop-in builder. Mirrors the
// terrainBrushState pattern: a module store the styled palette (outside Canvas) and the in-Canvas
// controller/render-layer share. One list of placed object instances per active map; saved/loaded
// through mapPersistence alongside the terrain. Transforms are stored in FINAL ENGINE space
// (world pos + yaw + uniform scale) so they never touch the Unity-conversion math.
import { useSyncExternalStore } from 'react';

export interface PlacedObject {
  id: string;                       // unique instance id
  set: string;                      // catalog set (e.g. 'alpine')
  file: string;                     // gltf filename in /siege/scifi/
  name: string;                     // display name
  pos: [number, number, number];    // world position (engine space)
  rotY: number;                     // yaw (radians)
  scale: number;                    // uniform scale multiplier
  // Optional richer transform (used by ACCEPTed procedural objects to preserve their look).
  tiltX?: number; tiltZ?: number;   // lean off vertical (radians)
  sx?: number; sy?: number; sz?: number;  // per-axis stretch multipliers (on top of `scale`)
  pgSetId?: string;                 // tags objects that came from a Generate → Accept batch
  noCollider?: boolean;             // skip BVH collider registration (perf for big accepted forests)
}
export interface ArmedAsset { set: string; file: string; name: string; }
export type GizmoMode = 'translate' | 'rotate' | 'scale';

interface BuilderState {
  enabled: boolean;                 // builder mode on/off (off = normal play untouched)
  objects: PlacedObject[];
  armed: ArmedAsset | null;         // asset to place next (null = selection mode)
  armedRotY: number;                // yaw to apply to the next placed object
  armedScale: number;               // scale to apply to the next placed object
  armedY: number;                   // manual Y offset above ground for the held item (scroll wheel)
  selectedId: string | null;        // currently selected placed object
  pgMode: 'place' | 'pg';           // manual placement vs procedural generation
}

let state: BuilderState = {
  enabled: false, objects: [], armed: null, armedRotY: 0, armedScale: 1, armedY: 0, selectedId: null, pgMode: 'place',
};
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function getBuilder(): BuilderState { return state; }
export function setBuilder(patch: Partial<BuilderState>): void { state = { ...state, ...patch }; emit(); }

let seq = 0;
export function addObject(o: Omit<PlacedObject, 'id'>): string {
  const id = `o${seq++}_${Math.floor(performance.now())}`;
  state = { ...state, objects: [...state.objects, { ...o, id }], selectedId: id };
  emit();
  return id;
}
export function updateObject(id: string, patch: Partial<PlacedObject>): void {
  state = { ...state, objects: state.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) };
  emit();
}
export function removeObject(id: string): void {
  state = { ...state, objects: state.objects.filter((o) => o.id !== id), selectedId: state.selectedId === id ? null : state.selectedId };
  emit();
}
export function clearObjects(): void { state = { ...state, objects: [], selectedId: null }; emit(); }
export function setObjects(objs: PlacedObject[]): void { state = { ...state, objects: objs, selectedId: null }; emit(); }

// Add many objects in ONE update (accepting a procedural batch — avoids per-object re-renders).
export function addObjects(list: Omit<PlacedObject, 'id'>[]): void {
  const added = list.map((o) => ({ ...o, id: `o${seq++}_${Math.floor(performance.now())}` }));
  state = { ...state, objects: [...state.objects, ...added] };
  emit();
}
export function countBySet(setId: string): number { return state.objects.filter((o) => o.pgSetId === setId).length; }
export function countPg(): number { return state.objects.filter((o) => o.pgSetId).length; }
// Remove a whole accepted batch (or ALL procedural objects if setId omitted) — clean delete, no orphans.
export function removeBySet(setId?: string): void {
  state = { ...state, objects: state.objects.filter((o) => (setId ? o.pgSetId !== setId : !o.pgSetId)), selectedId: null };
  emit();
}

export function useBuilder(): BuilderState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getBuilder, getBuilder);
}
