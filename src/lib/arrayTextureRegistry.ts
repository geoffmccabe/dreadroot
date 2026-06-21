// Stage 2a/2b: bridges the atlas-sync's per-texture specs to the array engine. Records
// each textureId's source URL and (when known) the atlas SLOT it occupies, so renderers
// map block_type → slot → url → CURRENT array layer. Keying by URL (not a frozen layer
// number) is what keeps the lookup correct under LRU eviction: a url's layer can change,
// so we always resolve the live layer from the manager at bake time. Flag-gated: only
// populated when the 'array' backend is active.
//
// Registration can happen before the engine has a GL context (atlas sync runs at world
// load); such calls queue and flush once the engine initialises.
import { getArrayTextureManager } from './arrayTextureManager';

interface Entry { textureId: string; layer: number; }

const idToUrl = new Map<string, string>();
const slotToUrl = new Map<number, string>();
const pending: Array<{ textureId: string; url: string; slot: number | null }> = [];

function doRegister(textureId: string, url: string, slot: number | null): void {
  idToUrl.set(textureId, url);
  if (slot !== null && slot >= 0) slotToUrl.set(slot, url);
  // Kick off streaming so the layer exists; the live layer is read later via the manager.
  getArrayTextureManager().resolve(url);
}

/** Record (or queue) a texture's source URL + the atlas slot it occupies. */
export function registerTextureId(textureId: string, url: string | null | undefined, slot: number | null = null): void {
  if (!url) return;
  if (getArrayTextureManager().isInited()) doRegister(textureId, url, slot);
  else pending.push({ textureId, url, slot });
}

/** Resolve any registrations queued before the engine had a GL context. */
export function flushPendingRegistrations(): void {
  if (!getArrayTextureManager().isInited()) return;
  for (const p of pending) doRegister(p.textureId, p.url, p.slot);
  pending.length = 0;
}

export function getTextureIdLayer(textureId: string): number | null {
  const url = idToUrl.get(textureId);
  if (url === undefined) return null;
  return getArrayTextureManager().currentLayerOf(url);
}

/** The CURRENT array layer for an atlas slot (side-effect-free — does NOT touch LRU, so
 *  baking the whole lookup can't defeat eviction). null if its url isn't resident. */
export function getSlotLayer(slot: number): number | null {
  const url = slotToUrl.get(slot);
  if (url === undefined) return null;
  return getArrayTextureManager().currentLayerOf(url);
}

export function getRegisteredEntries(): Entry[] {
  const mgr = getArrayTextureManager();
  const out: Entry[] = [];
  for (const [textureId, url] of idToUrl) {
    out.push({ textureId, layer: mgr.currentLayerOf(url) ?? 0 });
  }
  return out;
}

/** Bake slot→layer into a Float32Array (index = atlas slot, value = the slot's url's
 *  CURRENT array layer; 0 = placeholder for unresolved/evicted slots). Side-effect-free
 *  (reads the live layer without touching LRU); reflects post-eviction layer moves. */
export function buildSlotLayerData(slots = 1024): Float32Array {
  const data = new Float32Array(slots); // defaults to 0 (placeholder layer)
  const mgr = getArrayTextureManager();
  for (const [slot, url] of slotToUrl) {
    if (slot < 0 || slot >= slots) continue;
    data[slot] = mgr.currentLayerOf(url) ?? 0;
  }
  return data;
}

export function slotLayerCount(): number { return slotToUrl.size; }
