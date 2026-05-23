// convert-texture-to-ktx2
// ------------------------------------------------------------
// Encodes a PNG/WebP/JPG source texture to KTX2 (Basis Universal,
// UASTC mode) and uploads the result to Supabase Storage.
// Returns the new public URL.
//
// Body: { sourceUrl: string, tier?: 'standard' | 'premium' }
//   standard = 256×256 max
//   premium  = 1024×1024 max
// Response: { ktx2Url: string, bytesIn: number, bytesOut: number }
//
// Deploy via Supabase dashboard. Requires:
//   - storage bucket `ktx2-textures` (public read)
//   - service-role auth (set via SUPABASE_SERVICE_ROLE_KEY secret)
// ------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// Basis Universal encoder. WASM is fetched from jsDelivr at runtime so
// no separate hosting is needed.
import { encodeToKTX2 } from "npm:ktx2-encoder@0.0.7";

const STANDARD_MAX = 256;
const PREMIUM_MAX = 1024;
const BUCKET = "ktx2-textures";

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let sourceUrl: string;
  let tier: "standard" | "premium";
  try {
    const body = await req.json();
    sourceUrl = String(body.sourceUrl);
    tier = body.tier === "premium" ? "premium" : "standard";
    if (!sourceUrl) throw new Error("sourceUrl required");
  } catch (e) {
    return Response.json({ error: `bad body: ${e.message}` }, { status: 400 });
  }

  // 1. Fetch the source image.
  const srcResp = await fetch(sourceUrl);
  if (!srcResp.ok) {
    return Response.json(
      { error: `source fetch failed: ${srcResp.status}` },
      { status: 502 },
    );
  }
  const srcBytes = new Uint8Array(await srcResp.arrayBuffer());
  const maxSide = tier === "premium" ? PREMIUM_MAX : STANDARD_MAX;

  // 2. Encode with Basis UASTC. ktx2-encoder reads PNG/JPG bytes
  // directly via its bundled image decoder.
  let ktx2: Uint8Array;
  try {
    ktx2 = await encodeToKTX2(srcBytes.buffer, {
      uastc: true,
      generateMipmap: true,
      maxSize: maxSide,
      // UASTC level 2 = balanced quality/speed. Higher = slower.
      uastcLevel: 2,
    });
  } catch (e) {
    return Response.json(
      { error: `encode failed: ${e.message}` },
      { status: 500 },
    );
  }

  // 3. Derive a stable destination path from the source URL.
  // We hash the URL to keep paths short and deterministic per source.
  const hashBuf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(sourceUrl),
  );
  const hash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  const dest = `${tier}/${hash}.ktx2`;

  // 4. Upload to Storage (overwrite if exists — idempotent).
  const { error: upErr } = await supa.storage
    .from(BUCKET)
    .upload(dest, ktx2, {
      contentType: "image/ktx2",
      upsert: true,
      cacheControl: "31536000, immutable",
    });
  if (upErr) {
    return Response.json(
      { error: `upload failed: ${upErr.message}` },
      { status: 500 },
    );
  }

  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(dest);
  return Response.json({
    ktx2Url: pub.publicUrl,
    bytesIn: srcBytes.byteLength,
    bytesOut: ktx2.byteLength,
    tier,
  });
});
