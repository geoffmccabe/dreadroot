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
const pending: Array<{ textureId: string; url: string }> = [];

function doResolve(textureId: string, url: string): void {
  const { layer } = getArrayTextureManager().resolve(url);
  idToLayer.set(textureId, layer);
}

/** Record (or queue) the array layer for a textureId's source URL. */
export function registerTextureId(textureId: string, url: string | null | undefined): void {
  if (!url) return;
  if (getArrayTextureManager().isInited()) doResolve(textureId, url);
  else pending.push({ textureId, url });
}

/** Resolve any registrations queued before the engine had a GL context. */
export function flushPendingRegistrations(): void {
  if (!getArrayTextureManager().isInited()) return;
  for (const p of pending) doResolve(p.textureId, p.url);
  pending.length = 0;
}

export function getTextureIdLayer(textureId: string): number | null {
  const l = idToLayer.get(textureId);
  return l === undefined ? null : l;
}

export function getRegisteredEntries(): Entry[] {
  return [...idToLayer.entries()].map(([textureId, layer]) => ({ textureId, layer }));
}
