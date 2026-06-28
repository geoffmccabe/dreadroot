// siegeColliderCache — caches the per-instance MONSTER-CLIMB boxes (the voxelize results) so repeat
// loads skip the per-instance voxelization that runs on the MAIN THREAD during world build (a big
// part of the SWW load freeze). The boxes are pure data (world-space Box3s → flat number arrays).
//
// IndexedDB is async but GroupInstances builds synchronously in a useMemo, so we load the whole
// world's cached boxes into an in-memory map ONCE (loadColliderCache) before any group renders, then
// read it synchronously per group. Cold loads compute as usual and record (debounced auto-save).
// Keyed per group by a signature over (fbx, sub-mesh, its instance matrices) — a re-export changes
// the matrices → the signature changes → automatic cache miss + rebuild.
import * as THREE from 'three';
import { swwCacheGet, swwCachePut } from './siegeWorldCache';

type BoxArr = number[];   // [minx,miny,minz, maxx,maxy,maxz] repeated
const mem = new Map<string, BoxArr>();
let loadedKey: string | null = null;
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Load all cached boxes for a world (one IndexedDB read) into memory. Call + await before rendering
 *  groups so getCachedBoxes() can be read synchronously. */
export async function loadColliderCache(worldKey: string): Promise<void> {
  if (loadedKey === worldKey) return;
  mem.clear();
  loadedKey = worldKey;
  const blob = await swwCacheGet<Record<string, BoxArr>>('colliders', worldKey);
  if (blob && loadedKey === worldKey) for (const k of Object.keys(blob)) mem.set(k, blob[k]);
}

/** Stable per-group signature over its sub-mesh + instance matrices (FNV-1a over the floats). */
export function groupColliderSig(fbx: string, meshName: string | undefined, matrices: number[][]): string {
  let h = 0x811c9dc5;
  for (const mtx of matrices) for (let j = 0; j < mtx.length; j++) { h ^= (mtx[j] * 4096) | 0; h = Math.imul(h, 0x01000193); }
  return `${fbx}|${meshName ?? ''}|${matrices.length}|${(h >>> 0).toString(36)}`;
}

/** Cached world-space boxes for a group, or null on a miss (synchronous — reads the in-memory map). */
export function getCachedBoxes(sig: string): THREE.Box3[] | null {
  const a = mem.get(sig);
  if (!a) return null;
  const out: THREE.Box3[] = [];
  for (let i = 0; i + 5 < a.length; i += 6) {
    out.push(new THREE.Box3(new THREE.Vector3(a[i], a[i + 1], a[i + 2]), new THREE.Vector3(a[i + 3], a[i + 4], a[i + 5])));
  }
  return out;
}

/** Record freshly-built boxes for a group (cold load) + schedule a debounced save of the world blob. */
export function recordBoxes(worldKey: string, sig: string, boxes: THREE.Box3[]): void {
  if (loadedKey !== worldKey) return;   // a different world is active — don't cross-contaminate
  const a: BoxArr = [];
  for (const b of boxes) a.push(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
  mem.set(sig, a);
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  // Save a few seconds after the LAST record, i.e. once the cold-load build has settled.
  saveTimer = setTimeout(() => {
    if (!dirty || loadedKey !== worldKey) return;
    dirty = false;
    void swwCachePut('colliders', worldKey, Object.fromEntries(mem));
  }, 4000);
}
