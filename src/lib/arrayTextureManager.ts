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
  // Bumped on every layer mapping change (assign / evict / image-uploaded). Consumers
  // (the slot→layer lookup) rebuild when this changes, since a url's layer can change
  // under LRU without the resident COUNT changing.
  private revision = 0;

  // Resident map in LRU order: re-inserting on access moves a url to the end (newest);
  // the first key is the least-recently-used eviction candidate.
  private urlToLayer = new Map<string, number>();
  private layerToUrl: (string | null)[] = [];
  private readyLayers = new Set<number>();
  // In-flight loads keyed by LAYER (not url): a url evicted then re-resolved gets a new
  // layer that must still load even while the old layer's load is finishing.
  private loadingLayers = new Set<number>();
  // For animation-frame layers: maps a composite key (`url#frame`) to which strip URL to
  // fetch + which frame to slice. Plain (static) keys are just the url, absent from here.
  private keyInfo = new Map<string, { url: string; frame: number; frameCount: number }>();
  private freeLayers: number[] = [];
  private decodeCanvas: HTMLCanvasElement | null = null;
  private decodeCtx: CanvasRenderingContext2D | null = null;

  isInited(): boolean { return this.inited; }
  getRevision(): number { return this.revision; }
  /** The layer a url currently occupies, or null if not resident (no side effects). */
  currentLayerOf(url: string): number | null {
    const l = this.urlToLayer.get(url);
    return l === undefined ? null : l;
  }

  /** Detect device caps and create the array texture. Pass the R3F renderer's gl.
   *  No-op on WebGL1 (sampler2DArray / R32F texelFetch need WebGL2) — renderers then
   *  fall back to the atlas since the engine stays un-inited. */
  init(gl: THREE.WebGLRenderer): void {
    if (this.inited) return;
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const isWebGL2 = !!gl.capabilities?.isWebGL2 ||
      (typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext);
    if (!isWebGL2) {
      console.warn('[ArrayTexture] WebGL2 required — staying on the atlas backend.');
      return;
    }
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
    this.revision++;
    void this.load(url, layer);
    return { layer, ready: false };
  }

  /** Resolve a single ANIMATION FRAME of a sprite-strip to its own layer (frame i is the
   *  i-th horizontal slice). frameCount<=1 behaves exactly like resolve(url). */
  resolveFrame(url: string, frame: number, frameCount: number): LayerResolution {
    if (!url || frameCount <= 1) return this.resolve(url);
    const key = `${url}#${frame}`;
    if (!this.keyInfo.has(key)) this.keyInfo.set(key, { url, frame, frameCount });
    return this.resolve(key);
  }

  getTexture(): THREE.DataArrayTexture | null { return this.tex; }

  stats(): ArrayTextureManagerStats {
    return {
      inited: this.inited,
      layerCount: this.layerCount,
      layerRes: this.layerRes,
      resident: this.urlToLayer.size,
      ready: this.readyLayers.size,
      loading: this.loadingLayers.size,
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
    this.loadingLayers.delete(layer);
    this.evictions++;
    this.revision++; // the evicted url's layer changed (now unresolved)
    return layer;
  }

  private async load(key: string, layer: number): Promise<void> {
    // Dedup per LAYER: a key re-resolved to a NEW layer must still load even if its old
    // layer's load is mid-flight (the old one bails via the layerToUrl guard below).
    if (this.loadingLayers.has(layer)) return;
    this.loadingLayers.add(layer);
    const info = this.keyInfo.get(key);
    const fetchUrl = info ? info.url : key; // frame keys fetch the underlying strip URL
    try {
      const resp = await fetch(fetchUrl);
      const blob = await resp.blob();
      let px: Uint8ClampedArray;
      if (info && info.frameCount > 1) {
        // Slice out this frame (horizontal sprite-strip), flipped into the layer.
        px = await this.sliceFrameToPixels(blob, info.frame, info.frameCount);
      } else {
        try {
          const bmp = await createImageBitmap(blob, {
            resizeWidth: this.layerRes, resizeHeight: this.layerRes, resizeQuality: 'high',
          } as ImageBitmapOptions);
          px = this.bitmapToPixels(bmp);
          bmp.close?.();
        } catch {
          // Safari fallback: decode the SAME fetched blob via <img> (matches CORS state of
          // the primary path — re-fetching the url could taint the canvas instead).
          px = await this.blobToPixelsViaImg(blob);
        }
      }
      // Bail if the layer was evicted/reassigned while we were loading.
      if (this.layerToUrl[layer] !== key) return;
      this.writeLayer(layer, px);
      this.readyLayers.add(layer);
      this.revision++; // image arrived
    } catch {
      // leave the placeholder in place
    } finally {
      this.loadingLayers.delete(layer);
    }
  }

  // Decode a sprite-strip blob and draw frame `frame` (the i-th equal horizontal slice)
  // flipped into one layer.
  private async sliceFrameToPixels(blob: Blob, frame: number, frameCount: number): Promise<Uint8ClampedArray> {
    const bmp = await createImageBitmap(blob);
    const fw = bmp.width / frameCount;
    const ctx = this.decodeCtx!;
    ctx.save();
    ctx.clearRect(0, 0, this.layerRes, this.layerRes);
    ctx.translate(0, this.layerRes);
    ctx.scale(1, -1);
    ctx.drawImage(bmp, frame * fw, 0, fw, bmp.height, 0, 0, this.layerRes, this.layerRes);
    ctx.restore();
    bmp.close?.();
    return ctx.getImageData(0, 0, this.layerRes, this.layerRes).data;
  }

  // Draw vertically FLIPPED so the stored layer is bottom-up — DataArrayTexture ignores
  // flipY (unlike CanvasTexture, which the atlas relies on), so without this every real
  // texture would sample upside down. Storing flipped lets shaders use standard UVs and
  // matches the atlas convention.
  private drawFlipped(src: CanvasImageSource): Uint8ClampedArray {
    const ctx = this.decodeCtx!;
    ctx.save();
    ctx.clearRect(0, 0, this.layerRes, this.layerRes);
    ctx.translate(0, this.layerRes);
    ctx.scale(1, -1);
    ctx.drawImage(src, 0, 0, this.layerRes, this.layerRes);
    ctx.restore();
    return ctx.getImageData(0, 0, this.layerRes, this.layerRes).data;
  }

  private bitmapToPixels(bmp: ImageBitmap): Uint8ClampedArray {
    return this.drawFlipped(bmp);
  }

  private blobToPixelsViaImg(blob: Blob): Promise<Uint8ClampedArray> {
    return new Promise((resolve, reject) => {
      const objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { try { resolve(this.drawFlipped(img)); } finally { URL.revokeObjectURL(objUrl); } };
      img.onerror = (e) => { URL.revokeObjectURL(objUrl); reject(e); };
      img.src = objUrl;
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
