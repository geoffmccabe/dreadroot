// Generates the "dark-rim circle" cookie texture for a spotlight's .map. The spotlight
// mixes its colour by the texture's RGB×alpha, so a bright core that dips to a dark ring
// near the edge gives the round beam-with-dark-rim look. Cached per (rimDarkness,
// rimSoftness) so dragging the sliders doesn't allocate a texture every frame.
import * as THREE from 'three';

// Bounded LRU so scrubbing the rim sliders can't leak thousands of GPU textures.
const cache = new Map<string, THREE.CanvasTexture>();
const MAX_CACHE = 16;

export function cookieTexture(rimDarkness: number, rimSoftness: number): THREE.CanvasTexture {
  // 1-decimal key: finer is not visually meaningful and bounds the variety.
  const key = `${rimDarkness.toFixed(1)}|${rimSoftness.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // touch (LRU)
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) { cache.get(oldest)?.dispose(); cache.delete(oldest); }
  }

  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const c = (S - 1) / 2;
  const soft = Math.max(0.02, rimSoftness * 0.5); // edge feather width (fraction of radius)

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy); // 0 center .. 1 edge
      // Brightness: full in the core, dipping toward a dark ring near the edge.
      const ring = 1 - rimDarkness * smooth(0.55, 0.92, d); // 1 -> (1-rimDarkness) toward rim
      // Alpha: solid inside, feathered to 0 at the circle edge.
      const a = 1 - smooth(1 - soft, 1, d);
      const v = Math.max(0, Math.min(1, ring)) * 255;
      const o = (y * S + x) * 4;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v;
      img.data[o + 3] = Math.max(0, Math.min(1, a)) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// The glowing FACE disc: a bright core in the light's colour, ringed by a dark-grey
// rim (the bezel) so it reads as a lit fixture, fading to transparent at the edge.
// Cached per colour.
const discCache = new Map<string, THREE.CanvasTexture>();
const DISC_MAX = 12;

export function discTexture(colorHex: string): THREE.CanvasTexture {
  const hit = discCache.get(colorHex);
  if (hit) { discCache.delete(colorHex); discCache.set(colorHex, hit); return hit; }
  if (discCache.size >= DISC_MAX) {
    const oldest = discCache.keys().next().value as string | undefined;
    if (oldest !== undefined) { discCache.get(oldest)?.dispose(); discCache.delete(oldest); }
  }
  const col = new THREE.Color(colorHex);
  const cr = Math.round(col.r * 255), cg = Math.round(col.g * 255), cb = Math.round(col.b * 255);
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const c = (S - 1) / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const d = Math.sqrt(dx * dx + dy * dy); // 0 center .. 1 edge
      let r: number, g: number, b: number, a: number;
      if (d < 0.62) {
        // Bright core (lighten toward the centre).
        const k = 1 - 0.25 * (d / 0.62);
        r = Math.min(255, cr * k + 60 * (1 - d)); g = Math.min(255, cg * k + 60 * (1 - d)); b = Math.min(255, cb * k + 60 * (1 - d));
        a = 255;
      } else if (d < 0.9) {
        // Dark-grey bezel rim.
        r = g = b = 60; a = 255;
      } else {
        // Feather to transparent at the very edge.
        r = g = b = 60; a = (1 - smooth(0.9, 1.0, d)) * 255;
      }
      const o = (y * S + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  discCache.set(colorHex, tex);
  return tex;
}
