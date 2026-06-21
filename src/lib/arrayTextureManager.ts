// Array-texture working set — the layer-stack engine that replaces the packed atlas.
//
// A THREE.DataArrayTexture is a fixed pool of equal-size layers (one full-res texture
// per layer), selected per-instance by a LAYER INDEX. A url→layer map with LRU eviction
// keeps only the on-screen working set resident, so it scales to many worlds + user
// uploads (deduped by url across games). See docs/TEXTURE_ARRAY_MIGRATION_PLAN.md.
//
// Stage 1: the engine works in isolation (capability detection, streaming, LRU). No
// renderer consumes it yet — the admin debug panel exercises + visualises it.
import * as THREE from 'three';

export interface LayerResolution {
  layer: number;   // array layer (0 = loading/missing placeholder)
  ready: boolean;  // true once the real texture is resident
}

export interface ArrayTextureManagerStats {
  inited: boolean;
  layerCount: number;
  layerRes: number;
  resident: number; // distinct urls holding a layer
  ready: number;    // layers whose real image is uploaded
  loading: number;  // in-flight loads
  free: number;     // unused layers
  evictions: number;
}

const LAYER_RES = 256;
const PLACEHOLDER_LAYER = 0;
// Conservative per-device budgets (the GPU's MAX_ARRAY_TEXTURE_LAYERS caps this anyway).
const MOBILE_BUDGET = 384;
const DESKTOP_BUDGET = 1024;

function isMobile(): boolean {
  return typeof window !== 'undefined' &&
    ((!!window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      Math.min(window.innerWidth, window.innerHeight) < 800);
}

class ArrayTextureManagerImpl {
  layerCount = 0;
  layerRes = LAYER_RES;

  private buffer: Uint8Array | null = null;
  private tex: THREE.DataArrayTexture | null = null;
  private inited = false;
  private evictions = 0;

  // Resident map in LRU order: re-inserting on access moves a url to the end (newest);
  // the first key is the least-recently-used eviction candidate.
  private urlToLayer = new Map<string, number>();
  private layerToUrl: (string | null)[] = [];
  private readyLayers = new Set<number>();
  private loading = new Set<string>();
  private freeLayers: number[] = [];
  private decodeCanvas: HTMLCanvasElement | null = null;
  private decodeCtx: CanvasRenderingContext2D | null = null;

  isInited(): boolean { return this.inited; }

  /** Detect device caps and create the array texture. Pass the R3F renderer's gl. */
  init(gl: THREE.WebGLRenderer): void {
    if (this.inited) return;
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const maxLayers = (ctx && ctx.getParameter && ctx.getParameter(ctx.MAX_ARRAY_TEXTURE_LAYERS)) || 256;
    const budget = isMobile() ? MOBILE_BUDGET : DESKTOP_BUDGET;
    this.layerCount = Math.max(16, Math.min(maxLayers, budget));

    const layerBytes = this.layerRes * this.layerRes * 4;
    this.buffer = new Uint8Array(layerBytes * this.layerCount);
    this.tex = new THREE.DataArrayTexture(this.buffer, this.layerRes, this.layerRes, this.layerCount);
    this.tex.format = THREE.RGBAFormat;
    this.tex.type = THREE.UnsignedByteType;
    this.tex.minFilter = THREE.LinearFilter; // no mipmaps for streamed layers (Stage 5 can add)
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = THREE.ClampToEdgeWrapping;
    this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;

    this.decodeCanvas = document.createElement('canvas');
    this.decodeCanvas.width = this.decodeCanvas.height = this.layerRes;
    this.decodeCtx = this.decodeCanvas.getContext('2d', { willReadFrequently: true });

    this.layerToUrl = new Array(this.layerCount).fill(null);
    this.fillLayer(PLACEHOLDER_LAYER, 60, 60, 70); // dark grey placeholder
    for (let i = this.layerCount - 1; i >= 1; i--) this.freeLayers.push(i); // 0 reserved
    this.inited = true;
  }

  /** Resolve a url to a layer, streaming it in if needed; marks it most-recently-used. */
  resolve(url: string): LayerResolution {
    if (!this.inited || !url) return { layer: PLACEHOLDER_LAYER, ready: false };
    const existing = this.urlToLayer.get(url);
    if (existing !== undefined) {
      this.urlToLayer.delete(url);     // move to newest (LRU touch)
      this.urlToLayer.set(url, existing);
      return { layer: existing, ready: this.readyLayers.has(existing) };
    }
    const layer = this.allocLayer();
    this.urlToLayer.set(url, layer);
    this.layerToUrl[layer] = url;
    this.fillLayer(layer, 60, 60, 70); // placeholder until the image loads
    void this.load(url, layer);
    return { layer, ready: false };
  }

  getTexture(): THREE.DataArrayTexture | null { return this.tex; }

  stats(): ArrayTextureManagerStats {
    return {
      inited: this.inited,
      layerCount: this.layerCount,
      layerRes: this.layerRes,
      resident: this.urlToLayer.size,
      ready: this.readyLayers.size,
      loading: this.loading.size,
      free: this.freeLayers.length,
      evictions: this.evictions,
    };
  }

  private allocLayer(): number {
    const free = this.freeLayers.pop();
    if (free !== undefined) return free;
    // Evict least-recently-used (first key in the insertion-ordered map).
    const oldestUrl = this.urlToLayer.keys().next().value as string | undefined;
    if (oldestUrl === undefined) return PLACEHOLDER_LAYER;
    const layer = this.urlToLayer.get(oldestUrl)!;
    this.urlToLayer.delete(oldestUrl);
    this.layerToUrl[layer] = null;
    this.readyLayers.delete(layer);
    this.loading.delete(oldestUrl);
    this.evictions++;
    return layer;
  }

  private async load(url: string, layer: number): Promise<void> {
    if (this.loading.has(url)) return;
    this.loading.add(url);
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      let px: Uint8ClampedArray;
      try {
        const bmp = await createImageBitmap(blob, {
          resizeWidth: this.layerRes, resizeHeight: this.layerRes, resizeQuality: 'high',
        } as ImageBitmapOptions);
        px = this.bitmapToPixels(bmp);
        bmp.close?.();
      } catch {
        // Safari fallback: <img> → canvas (no resize option on createImageBitmap).
        px = await this.urlToPixelsViaImg(url);
      }
      // Bail if the layer was evicted/reassigned while we were loading.
      if (this.layerToUrl[layer] !== url) { this.loading.delete(url); return; }
      this.writeLayer(layer, px);
      this.readyLayers.add(layer);
    } catch {
      // leave the placeholder in place
    } finally {
      this.loading.delete(url);
    }
  }

  private bitmapToPixels(bmp: ImageBitmap): Uint8ClampedArray {
    const ctx = this.decodeCtx!;
    ctx.clearRect(0, 0, this.layerRes, this.layerRes);
    ctx.drawImage(bmp, 0, 0, this.layerRes, this.layerRes);
    return ctx.getImageData(0, 0, this.layerRes, this.layerRes).data;
  }

  private urlToPixelsViaImg(url: string): Promise<Uint8ClampedArray> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const ctx = this.decodeCtx!;
        ctx.clearRect(0, 0, this.layerRes, this.layerRes);
        ctx.drawImage(img, 0, 0, this.layerRes, this.layerRes);
        resolve(ctx.getImageData(0, 0, this.layerRes, this.layerRes).data);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  private writeLayer(layer: number, px: Uint8ClampedArray | Uint8Array): void {
    if (!this.buffer || !this.tex) return;
    const off = layer * this.layerRes * this.layerRes * 4;
    this.buffer.set(px, off);
    this.tex.layerUpdates.add(layer); // upload ONLY this layer (texSubImage3D)
    this.tex.needsUpdate = true;
  }

  private fillLayer(layer: number, r: number, g: number, b: number): void {
    if (!this.buffer) return;
    const n = this.layerRes * this.layerRes;
    const off = layer * n * 4;
    for (let i = 0; i < n; i++) {
      const o = off + i * 4;
      this.buffer[o] = r; this.buffer[o + 1] = g; this.buffer[o + 2] = b; this.buffer[o + 3] = 255;
    }
    if (this.tex) { this.tex.layerUpdates.add(layer); this.tex.needsUpdate = true; }
  }
}

let singleton: ArrayTextureManagerImpl | null = null;
export function getArrayTextureManager(): ArrayTextureManagerImpl {
  if (!singleton) singleton = new ArrayTextureManagerImpl();
  return singleton;
}
