// Phase 4 / Slice 4a — KTX2 RUNTIME (decode side). The ENCODE side lives in ktx2.ts
// (admin tab → Basis UASTC + mips → Supabase `*_url_ktx2`). This module is the missing
// half: load those `.ktx2` files at runtime and transcode them to the device's best
// GPU-compressed format, so layers can be stored compressed (~4× less VRAM than RGBA).
//
// three's KTX2Loader needs the Basis *transcoder* (decoder) wasm — separate from the
// encoder wasm. We copied it to /public/basis/ (basis_transcoder.js + .wasm).
//
// 4a is foundation only: init the loader, detect the device format, and load one file to
// prove the path. 4b wires the transcoded mips into a CompressedArrayTexture.
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

let loader: KTX2Loader | null = null;
let supported: boolean | null = null;

/** Human-readable name for a transcoded compressed-texture format constant. */
export function formatName(format: number): string {
  const map: Record<number, string> = {
    [THREE.RGBA_ASTC_4x4_Format]: 'ASTC 4x4',
    [THREE.RGBA_BPTC_Format]: 'BC7 (BPTC)',
    [THREE.RGBA_S3TC_DXT5_Format]: 'BC3 (DXT5)',
    [THREE.RGB_S3TC_DXT1_Format]: 'BC1 (DXT1)',
    [THREE.RGBA_ETC2_EAC_Format]: 'ETC2 EAC',
    [THREE.RGBAFormat]: 'RGBA (uncompressed fallback)',
  };
  return map[format] ?? `format#${format}`;
}

/** Create the KTX2Loader once and let it probe the renderer for supported formats.
 *  detectSupport() must run with a live renderer before any load. Idempotent. */
export function initKtx2(gl: THREE.WebGLRenderer): KTX2Loader {
  if (!loader) {
    loader = new KTX2Loader()
      .setTranscoderPath('/basis/')
      .detectSupport(gl);
    // detectSupport sets the loader's workerConfig; if no compressed format is available
    // it still transcodes to RGBA32 (so this never hard-fails, just loses the VRAM win).
    supported = true;
  }
  return loader;
}

export function isKtx2Ready(): boolean {
  return !!loader;
}

export interface Ktx2Probe {
  format: number;
  formatLabel: string;
  width: number;
  height: number;
  mipCount: number;
  compressed: boolean;
}

/** Load + transcode one `.ktx2` to a CompressedTexture (or RGBA fallback). Returns the
 *  texture plus a metadata probe. Throws if the loader isn't inited or the load fails. */
export async function loadKtx2(url: string): Promise<{ texture: THREE.CompressedTexture; probe: Ktx2Probe }> {
  if (!loader) throw new Error('KTX2 runtime not initialised — call initKtx2(gl) first');
  const texture = (await loader.loadAsync(url)) as THREE.CompressedTexture;
  const mips = (texture.mipmaps ?? []) as Array<{ width: number; height: number }>;
  const probe: Ktx2Probe = {
    format: texture.format as number,
    formatLabel: formatName(texture.format as number),
    width: texture.image?.width ?? mips[0]?.width ?? 0,
    height: texture.image?.height ?? mips[0]?.height ?? 0,
    mipCount: mips.length,
    compressed: (texture.format as number) !== THREE.RGBAFormat,
  };
  return { texture, probe };
}

/** Best-effort: free the transcoder workers (call on teardown; rarely needed). */
export function disposeKtx2(): void {
  loader?.dispose();
  loader = null;
  supported = null;
}

export function ktx2Supported(): boolean | null {
  return supported;
}
