// Browser-side KTX2 conversion (Basis Universal, UASTC + mips).
// Runs in the admin's tab — no edge function required.
// Result is uploaded to the existing `block-textures` bucket under
// `ktx2/<tier>/<hash>.ktx2` and the public URL is returned.

import { encodeToKTX2 } from 'ktx2-encoder';
import { supabase } from '@/integrations/supabase/client';

// Served from /public — the ktx2-encoder package's `exports` field
// doesn't expose dist/basis/*, so we copy them in instead of importing.
const wasmUrl = '/basis_encoder.wasm';
const jsUrl = '/basis_encoder.js';

export type Ktx2Tier = 'standard' | 'premium';

const TIER_MAX_SIDE: Record<Ktx2Tier, number> = {
  standard: 256,
  premium: 1024,
};

async function fetchAndMaybeResize(sourceUrl: string, maxSide: number): Promise<Uint8Array> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`source fetch ${resp.status}`);
  const blob = await resp.blob();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    // Can't decode here — pass raw bytes through; encoder may still handle them.
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Already within budget — no resize, ship the original bytes.
  if (Math.max(bitmap.width, bitmap.height) <= maxSide) {
    bitmap.close();
    return new Uint8Array(await blob.arrayBuffer());
  }

  const scale = maxSide / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('no 2d context');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const resized = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await resized.arrayBuffer());
}

async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export async function convertTextureToKtx2(
  sourceUrl: string,
  tier: Ktx2Tier = 'standard',
): Promise<string | null> {
  try {
    const sourceBytes = await fetchAndMaybeResize(sourceUrl, TIER_MAX_SIDE[tier]);

    const ktx2 = await encodeToKTX2(sourceBytes, {
      isKTX2File: true,
      isUASTC: true,
      generateMipmap: true,
      isPerceptual: true,
      isSetKTX2SRGBTransferFunc: true,
      wasmUrl,
      jsUrl,
    });

    const hash = await sha1Hex(`${sourceUrl}:${tier}`);
    const path = `${tier}/${hash}.ktx2`;

    const { error: upErr } = await supabase.storage
      .from('ktx2-textures')
      .upload(path, new Blob([ktx2], { type: 'image/ktx2' }), {
        upsert: true,
        cacheControl: '31536000',
      });

    if (upErr) {
      console.warn('[ktx2] upload failed:', upErr.message);
      return null;
    }

    const { data: pub } = supabase.storage
      .from('ktx2-textures')
      .getPublicUrl(path);

    const ratio = ((ktx2.length / sourceBytes.length) * 100).toFixed(0);
    console.log(`[ktx2] ${tier}: ${sourceBytes.length}B → ${ktx2.length}B (${ratio}%)`);
    return pub.publicUrl;
  } catch (e) {
    console.warn('[ktx2] convert failed:', e);
    return null;
  }
}
