// Per-monster BOX hitboxes (body + head), replacing the crude single-cylinder +
// "top fraction" head zone. Boxes are defined in the monster's LOCAL space
// (origin at the feet, +Y up, +Z the facing direction, +X right) as a center
// offset + half-extents, so they scale/rotate with the monster automatically.
//
// Keyed by model URL (stable per monster TYPE). Defaults are derived from the old
// cylinder so nothing changes until a monster is tuned; overrides persist to
// localStorage and can be exported (exportHitboxes) to bake into code.
//
// Used by: MonsterEnemy (render in !hb + editor), and the bullet frame loop
// (ray-OBB test → head box = headshot, body box = hit refinement).

export interface HBox { lx: number; ly: number; lz: number; hx: number; hy: number; hz: number; }
export interface MonsterHitbox { body: HBox; head: HBox; }

// v2: stored values are now HEIGHT-NORMALIZED (fractions of the monster's height)
// so one box scales correctly across same-model monsters of different sizes
// (e.g. the 1.8m Demon Horde + the 4m Red Demon share reddemon.glb). v1 stored
// absolute metres, so the key is bumped to ignore stale v1 data.
const LS_KEY = 'siege_hitboxes_v2';

// localStorage overrides (NORMALIZED), loaded once. These win over BAKED.
const overrides: Record<string, MonsterHitbox> = (() => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
})();

// Hand-tuned, baked-in defaults (NORMALIZED — fractions of height). Permanent for
// everyone on every device; localStorage overrides take precedence. Tuned in-world
// then committed here. reddemon.glb tuned on the 1.8m Demon Horde (÷1.8 to normalize).
const BAKED: Record<string, MonsterHitbox> = {
  // Exact tuned values (normalized ÷ tuned height). No extension — earlier I
  // over-extended the head by 15% of MONSTER height (huge vs a small head box).
  '/siege/monsters/reddemon.glb': {  // tuned on the 1.8m Demon Horde (÷1.8). Body extended to the
    body: { lx: 0.0278, ly: 0.3755, lz: 0.0556, hx: 0.1802, hy: 0.3755, hz: 0.1246 },  // feet (legs shootable)
    head: { lx: 0.0278, ly: 0.7397, lz: 0.1944, hx: 0.0667, hy: 0.0945, hz: 0.0691 },
  },
  '/siege/monsters/dfskeleton.glb': {  // Giant Skeleton (#3), tuned on the 6m instance (÷6). Body
    body: { lx: -0.0083, ly: 0.4430, lz: 0.0083, hx: 0.1278, hy: 0.4430, hz: 0.1111 },  // extended to the feet
    head: { lx: -0.0417, ly: 0.9085, lz: 0.1917, hx: 0.0945, hy: 0.1028, hz: 0.0861 },
  },
};

const scaleBox = (b: HBox, k: number): HBox => ({ lx: b.lx * k, ly: b.ly * k, lz: b.lz * k, hx: b.hx * k, hy: b.hy * k, hz: b.hz * k });

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function subscribeHitboxes(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(overrides)); } catch { /* ignore */ }
}

/** Default boxes from the legacy cylinder: body encloses it; head = top `headFrac`. */
export function defaultHitbox(radius: number, height: number, headFrac: number): MonsterHitbox {
  return {
    body: { lx: 0, ly: height / 2, lz: 0, hx: radius, hy: height / 2, hz: radius },
    head: { lx: 0, ly: height * (1 - headFrac / 2), lz: 0, hx: radius, hy: (height * headFrac) / 2, hz: radius },
  };
}

/** The effective hitbox for a monster IN ABSOLUTE METRES: localStorage override,
 *  else the baked-in tuned default, else the cylinder default — the first two are
 *  normalized so they're scaled by this monster's height. */
export function getHitboxFor(url: string, radius: number, height: number, headFrac: number): MonsterHitbox {
  const norm = overrides[url] ?? BAKED[url];
  if (norm) return { body: scaleBox(norm.body, height), head: scaleBox(norm.head, height) };
  return defaultHitbox(radius, height, headFrac);
}

export function hasOverride(url: string): boolean { return !!(overrides[url] || BAKED[url]); }

/** Save a monster's boxes from the editor. `hb` is in ABSOLUTE metres for a monster
 *  of `height`; stored normalized (÷height) so it scales to other sizes. */
export function setHitboxAbsolute(url: string, hb: MonsterHitbox, height: number): void {
  const k = 1 / Math.max(0.01, height);
  overrides[url] = { body: scaleBox(hb.body, k), head: scaleBox(hb.head, k) };
  persist();
  emit();
}

/** Drop a monster's localStorage override (back to the baked/cylinder default). */
export function resetHitboxFor(url: string): void {
  delete overrides[url];
  persist();
  emit();
}

/** Export all saved overrides: copy to the clipboard AND log to the console, with
 *  a count so you can confirm what's saved. Press `x` in edit mode. */
export function exportHitboxes(): void {
  const urls = Object.keys(overrides);
  const json = JSON.stringify(overrides, null, 2);
  const header = `[siege hitboxes] ${urls.length} saved: ${urls.join(', ') || '(none)'}`;
  // eslint-disable-next-line no-console
  console.log(header + '\n' + json);
  try {
    navigator.clipboard?.writeText(json);
    // eslint-disable-next-line no-console
    console.log('[siege hitboxes] ✅ copied to clipboard — paste it to save permanently.');
  } catch { /* clipboard may be blocked; the console log above still has it */ }
}

// ── Ray vs oriented box (the monster's local box, rotated by yaw, at world pos) ──
// Transforms the world ray into the monster's local frame, then does a slab AABB
// test. Returns the ENTRY distance t along [0,len] (≥0) on hit, else -1. Zero alloc.
export function rayBoxEntryT(
  box: HBox,
  mx: number, my: number, mz: number, yaw: number,   // monster world pos + facing yaw
  ox: number, oy: number, oz: number,                // ray origin (world)
  dx: number, dy: number, dz: number,                // ray direction (world, unit)
  len: number,
): number {
  const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
  const rx = ox - mx, ry = oy - my, rz = oz - mz;
  let lox = rx * cos + rz * sin;
  let loy = ry;
  let loz = -rx * sin + rz * cos;
  const ldx = dx * cos + dz * sin;
  const ldy = dy;
  const ldz = -dx * sin + dz * cos;
  lox -= box.lx; loy -= box.ly; loz -= box.lz;

  let tmin = 0, tmax = len;
  if (Math.abs(ldx) < 1e-8) { if (lox < -box.hx || lox > box.hx) return -1; }
  else { let t1 = (-box.hx - lox) / ldx, t2 = (box.hx - lox) / ldx; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(ldy) < 1e-8) { if (loy < -box.hy || loy > box.hy) return -1; }
  else { let t1 = (-box.hy - loy) / ldy, t2 = (box.hy - loy) / ldy; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(ldz) < 1e-8) { if (loz < -box.hz || loz > box.hz) return -1; }
  else { let t1 = (-box.hz - loz) / ldz, t2 = (box.hz - loz) / ldz; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  return tmin;
}

/** Boolean form: does the segment [0,len] enter the box? */
export function rayHitsBox(
  box: HBox,
  mx: number, my: number, mz: number, yaw: number,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  len: number,
): boolean {
  return rayBoxEntryT(box, mx, my, mz, yaw, ox, oy, oz, dx, dy, dz, len) >= 0;
}
