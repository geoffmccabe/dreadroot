// Texture backend switch — selects how block/tree/monster textures are sampled:
//   'atlas' : the current single 8192² packed atlas (1024 fixed slots, per-instance
//             UV offset). DEFAULT — unchanged behaviour for all games + co-build.
//   'array' : the new DataArrayTexture working set (one full-res layer per texture,
//             per-instance layer index, LRU streaming, no slot limit/bleed).
//
// See docs/TEXTURE_ARRAY_MIGRATION_PLAN.md. The 'array' path is built behind this flag
// in stages; renderers branch on isArrayBackend() so each surface can be flipped and
// verified independently while the atlas keeps running. localStorage override lets us
// test 'array' on one machine without changing the default for everyone.
import { useSyncExternalStore } from 'react';

export type TextureBackend = 'atlas' | 'array';

const KEY = 'textureBackend';
const DEFAULT: TextureBackend = 'atlas';

function read(): TextureBackend {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return v === 'array' ? 'array' : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let active: TextureBackend = read();
const subs = new Set<() => void>();

export function getTextureBackend(): TextureBackend {
  return active;
}

/** True when the new texture-array path should be used. Renderers branch on this. */
export function isArrayBackend(): boolean {
  return active === 'array';
}

export function setTextureBackend(b: TextureBackend): void {
  if (b === active) return;
  active = b;
  try { localStorage.setItem(KEY, b); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function useTextureBackend(): TextureBackend {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getTextureBackend,
    getTextureBackend,
  );
}
