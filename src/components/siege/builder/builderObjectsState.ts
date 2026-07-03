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

export function useBuilder(): BuilderState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, getBuilder, getBuilder);
}
