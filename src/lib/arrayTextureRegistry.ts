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
// slot → the engine KEY whose layer holds that atlas slot's image. For animated textures,
// each frame occupies a consecutive slot (baseSlot+frame) with key `url#frame`; static
// textures are one slot with key = url. The shader maps slot → layer via this.
const slotToKey = new Map<number, string>();
const pending: Array<{ textureId: string; url: string; slot: number | null; frameCount: number }> = [];

function doRegister(textureId: string, url: string, baseSlot: number | null, frameCount: number): void {
  idToUrl.set(textureId, url);
  const mgr = getArrayTextureManager();
  const frames = Math.max(1, frameCount);
  for (let f = 0; f < frames; f++) {
    // Stream this frame into its own layer; record which slot it fills.
    mgr.resolveFrame(url, f, frames);
    if (baseSlot !== null && baseSlot >= 0) {
      const key = frames > 1 ? `${url}#${f}` : url;
      slotToKey.set(baseSlot + f, key);
    }
  }
}

/** Record (or queue) a texture: its source URL, the atlas BASE slot it occupies, and how
 *  many animation frames it has (consecutive slots baseSlot..baseSlot+frameCount-1). */
export function registerTextureId(textureId: string, url: string | null | undefined, slot: number | null = null, frameCount = 1): void {
  if (!url) return;
  if (getArrayTextureManager().isInited()) doRegister(textureId, url, slot, frameCount);
  else pending.push({ textureId, url, slot, frameCount });
}

/** Resolve any registrations queued before the engine had a GL context. */
export function flushPendingRegistrations(): void {
  if (!getArrayTextureManager().isInited()) return;
  for (const p of pending) doRegister(p.textureId, p.url, p.slot, p.frameCount);
  pending.length = 0;
}

export function getTextureIdLayer(textureId: string): number | null {
  const url = idToUrl.get(textureId);
  if (url === undefined) return null;
  return getArrayTextureManager().currentLayerOf(url);
}

/** The CURRENT array layer for an atlas slot (side-effect-free — does NOT touch LRU, so
 *  baking the whole lookup can't defeat eviction). null if its key isn't resident. */
export function getSlotLayer(slot: number): number | null {
  const key = slotToKey.get(slot);
  if (key === undefined) return null;
  return getArrayTextureManager().currentLayerOf(key);
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
  for (const [slot, key] of slotToKey) {
    if (slot < 0 || slot >= slots) continue;
    data[slot] = mgr.currentLayerOf(key) ?? 0;
  }
  return data;
}

export function slotLayerCount(): number { return slotToKey.size; }
