// Array-texture working set (Stage 1+ — SCAFFOLD ONLY in Stage 0, no consumers yet).
//
// Replaces the packed atlas with a THREE.DataArrayTexture: a fixed pool of equal-size
// layers, one full-res texture per layer, selected per-instance by a LAYER INDEX. A
// url→layer map with LRU eviction keeps only the on-screen working set resident, so it
// scales to many worlds + user-uploaded textures (deduped by url across games).
// See docs/TEXTURE_ARRAY_MIGRATION_PLAN.md.
//
// Stage 0 establishes the interface + the branch point only. The real implementation
// (capability detection, DataArrayTexture, streaming/LRU) lands in Stage 1.

export interface LayerResolution {
  /** Array layer holding this texture (or the loading/missing placeholder layer). */
  layer: number;
  /** True once the real texture is resident (false while still streaming in). */
  ready: boolean;
}

export interface ArrayTextureManager {
  /** Layers available on this device (from MAX_ARRAY_TEXTURE_LAYERS). */
  readonly layerCount: number;
  /** Pixel size of each square layer. */
  readonly layerRes: number;
  /**
   * Resolve a texture URL to a layer index, streaming it in (async) if not resident
   * and marking it most-recently-used. Returns the placeholder layer until ready.
   */
  resolve(url: string): LayerResolution;
  /** The GPU array texture to bind as the shader's sampler2DArray. */
  getTexture(): unknown;
}

// Stage 0: no instance is created and nothing consumes this. Stage 1 will add the
// concrete implementation + a singleton accessor here.
