// Baked-instance transform overrides. The Enchanted Forest objects (cliffs, trees, …) are
// drawn as batched instances from placements.json — not DB rows. To let the Arrange tool move
// them, we record just the EDITS: per original-position key, a replacement placement matrix
// (or a hide flag). WorldObjectsLayer reads this map when it builds each batch, so edits
// survive streaming rebuilds; here we also live-update the instance so the move is immediate.
// Mirrors the collider-override pattern (keyed by rounded position, localStorage-backed).
import * as THREE from 'three';
import type { TRS, BakedRef } from './types';

export interface XformOverride { matrix?: number[]; hide?: boolean }

export const transformOverrides = new Map<string, XformOverride>();

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
  try {
    const raw = localStorage.getItem(lsKey());
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, XformOverride>)) transformOverrides.set(k, v);
  } catch { /* ignore */ }
}

function save(): void {
  try { localStorage.setItem(lsKey(), JSON.stringify(Object.fromEntries(transformOverrides))); } catch { /* ignore */ }
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
  _p.set(t.pos[0], t.pos[1], t.pos[2]);
  _q.set(t.quat[0], t.quat[1], t.quat[2], t.quat[3]);
  _s.set(t.scale[0], t.scale[1], t.scale[2]);
  _place.compose(_p, _q, _s);
  transformOverrides.set(ref.key, { matrix: _place.toArray() });
  save();
  _local.fromArray(ref.localArr);
  _m.multiplyMatrices(_place, _local);
  liveSet(ref, _m);
}

// "Delete" a baked instance = hide it (zero scale). Reversible via applyBakedTransform (undo).
export function hideBaked(ref: BakedRef): void {
  const prev = transformOverrides.get(ref.key);
  transformOverrides.set(ref.key, { ...prev, hide: true });
  save();
  liveSet(ref, _zero);
}
