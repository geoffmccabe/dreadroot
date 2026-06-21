// Stage 2a: bridges the atlas-sync's per-texture specs to the array engine. For each
// textureId (block/tree/monster texture key) it records the array LAYER its source URL
// streamed into — the parallel of the atlas's textureId→slot map. Renderers (2b/2c)
// look up block_type → textureId → layer here. Flag-gated: only populated when the
// 'array' backend is active, so default behaviour is untouched.
//
// Registration can happen before the engine has a GL context (atlas sync runs at world
// load); such calls queue and flush once the engine initialises.
import { getArrayTextureManager } from './arrayTextureManager';

interface Entry { textureId: string; layer: number; }

const idToLayer = new Map<string, number>();
// Renderers work in ATLAS SLOTS (they map block_type → slot via UVs). Mirror that:
// slot → array layer, so a renderer can go block_type → slot → layer with no decoding.
const slotToLayer = new Map<number, number>();
const pending: Array<{ textureId: string; url: string; slot: number | null }> = [];

function doResolve(textureId: string, url: string, slot: number | null): void {
  const { layer } = getArrayTextureManager().resolve(url);
  idToLayer.set(textureId, layer);
  if (slot !== null && slot >= 0) slotToLayer.set(slot, layer);
}

/** Record (or queue) the array layer for a textureId's source URL, and (if known) the
 *  atlas slot it occupies so renderers can look it up by slot. */
export function registerTextureId(textureId: string, url: string | null | undefined, slot: number | null = null): void {
  if (!url) return;
  if (getArrayTextureManager().isInited()) doResolve(textureId, url, slot);
  else pending.push({ textureId, url, slot });
}

/** Resolve any registrations queued before the engine had a GL context. */
export function flushPendingRegistrations(): void {
  if (!getArrayTextureManager().isInited()) return;
  for (const p of pending) doResolve(p.textureId, p.url, p.slot);
  pending.length = 0;
}

export function getTextureIdLayer(textureId: string): number | null {
  const l = idToLayer.get(textureId);
  return l === undefined ? null : l;
}

/** The array layer for an atlas slot index (renderer path). null if not registered. */
export function getSlotLayer(slot: number): number | null {
  const l = slotToLayer.get(slot);
  return l === undefined ? null : l;
}

export function getRegisteredEntries(): Entry[] {
  return [...idToLayer.entries()].map(([textureId, layer]) => ({ textureId, layer }));
}

/** Bake slot→layer into a Float32Array (index = atlas slot, value = array layer; 0 =
 *  placeholder for unregistered slots). The block renderer uploads this as a lookup
 *  texture so the shader can map an instance's atlas slot to its array layer. */
export function buildSlotLayerData(slots = 1024): Float32Array {
  const data = new Float32Array(slots); // defaults to 0 (placeholder layer)
  for (const [slot, layer] of slotToLayer) {
    if (slot >= 0 && slot < slots) data[slot] = layer;
  }
  return data;
}

/** Number of slot→layer entries (for change detection / debug). */
export function slotLayerCount(): number { return slotToLayer.size; }
