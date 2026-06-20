// Boulder projectiles (Elemental Golem). A thrown boulder follows a perfect parabolic arc to a
// target point, chosen at throw time, at a given launch angle. On landing it checks the player and,
// if close, deals damage + knockback away along the throw direction. Module-level (no React churn);
// the renderer reads getBoulders() and updateBoulders() runs each frame.
import { dealPlayerDamage } from './spray/sprayAttackSystem';

const G = 25;            // gravity (m/s²) — tuned for a visible, snappy arc
const HIT_RADIUS = 2.5;  // player is hit if within this of the impact point (m)

export interface Boulder {
  id: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  targetY: number;
  dirx: number; dirz: number;   // horizontal travel direction (for knockback)
  dmgMin: number; dmgMax: number; kbMin: number; kbMax: number;
}
let boulders: Boulder[] = [];
let seq = 0;
export function getBoulders(): Boulder[] { return boulders; }

// Launch a boulder from (ox,oy,oz) to land on (tx,ty,tz) at launch angle `angleDeg` from horizontal.
export function throwBoulder(
  ox: number, oy: number, oz: number, tx: number, ty: number, tz: number, angleDeg: number,
  opts: { dmgMin?: number; dmgMax?: number; kbMin?: number; kbMax?: number } = {},
) {
  const dx = tx - ox, dz = tz - oz;
  const d = Math.hypot(dx, dz) || 0.001;
  const dirx = dx / d, dirz = dz / d;
  const th = (angleDeg * Math.PI) / 180;
  const denom = (oy - ty) + d * Math.tan(th);     // > 0 when the arc can reach (origin above target)
  const v0 = denom > 0.1
    ? Math.sqrt((G * d * d) / (2 * Math.cos(th) ** 2 * denom))
    : Math.sqrt((G * d) / Math.max(0.1, Math.sin(2 * th)));   // level-ground fallback
  const vH = v0 * Math.cos(th), vy = v0 * Math.sin(th);
  boulders.push({
    id: seq++, x: ox, y: oy, z: oz, vx: dirx * vH, vy, vz: dirz * vH, targetY: ty, dirx, dirz,
    dmgMin: opts.dmgMin ?? 50, dmgMax: opts.dmgMax ?? 200, kbMin: opts.kbMin ?? 5, kbMax: opts.kbMax ?? 20,
  });
}

// Integrate + resolve impacts. playerPos = player feet position.
export function updateBoulders(dt: number, px: number, py: number, pz: number) {
  if (!boulders.length) return;
  const keep: Boulder[] = [];
  for (const b of boulders) {
    b.vy -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    const landed = b.y <= b.targetY;
    if (landed) {
      const horiz = Math.hypot(b.x - px, b.z - pz);
      if (horiz < HIT_RADIUS) {
        const dmg = b.dmgMin + Math.random() * (b.dmgMax - b.dmgMin);
        const kb = b.kbMin + Math.random() * (b.kbMax - b.kbMin);
        dealPlayerDamage(dmg, b.dirx, 0.15, b.dirz, kb, '/punched.mp3');   // knockback away along the throw
      }
      continue; // remove
    }
    if (b.y < b.targetY - 8) continue; // safety cull
    keep.push(b);
  }
  boulders = keep;
}

export function clearBoulders() { boulders = []; }
