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

const LS_KEY = 'siege_hitboxes_v1';

// Per-URL overrides, loaded once from localStorage.
const overrides: Record<string, MonsterHitbox> = (() => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
})();

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

/** The effective hitbox for a monster: stored override, else the cylinder default. */
export function getHitboxFor(url: string, radius: number, height: number, headFrac: number): MonsterHitbox {
  return overrides[url] ?? defaultHitbox(radius, height, headFrac);
}

export function hasOverride(url: string): boolean { return !!overrides[url]; }

/** Replace a monster's boxes (used by the editor) and persist + notify. */
export function setHitboxFor(url: string, hb: MonsterHitbox): void {
  overrides[url] = hb;
  persist();
  emit();
}

/** Drop a monster's override (back to the cylinder default). */
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
// test. Returns true if the segment [0,len] enters the box. Zero allocation.
export function rayHitsBox(
  box: HBox,
  mx: number, my: number, mz: number, yaw: number,   // monster world pos + facing yaw
  ox: number, oy: number, oz: number,                // ray origin (world)
  dx: number, dy: number, dz: number,                // ray direction (world, unit)
  len: number,
): boolean {
  // World → local: translate by -monster, rotate by -yaw about Y.
  const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
  const rx = ox - mx, ry = oy - my, rz = oz - mz;
  // local origin (rotate about Y): x' = x*cos + z*sin ; z' = -x*sin + z*cos
  let lox = rx * cos + rz * sin;
  let loy = ry;
  let loz = -rx * sin + rz * cos;
  let ldx = dx * cos + dz * sin;
  let ldy = dy;
  let ldz = -dx * sin + dz * cos;
  // Shift into box-center space.
  lox -= box.lx; loy -= box.ly; loz -= box.lz;

  // Slab test.
  let tmin = 0, tmax = len;
  // X
  if (Math.abs(ldx) < 1e-8) { if (lox < -box.hx || lox > box.hx) return false; }
  else {
    let t1 = (-box.hx - lox) / ldx, t2 = (box.hx - lox) / ldx;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return false;
  }
  // Y
  if (Math.abs(ldy) < 1e-8) { if (loy < -box.hy || loy > box.hy) return false; }
  else {
    let t1 = (-box.hy - loy) / ldy, t2 = (box.hy - loy) / ldy;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return false;
  }
  // Z
  if (Math.abs(ldz) < 1e-8) { if (loz < -box.hz || loz > box.hz) return false; }
  else {
    let t1 = (-box.hz - loz) / ldz, t2 = (box.hz - loz) / ldz;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return false;
  }
  return true;
}
