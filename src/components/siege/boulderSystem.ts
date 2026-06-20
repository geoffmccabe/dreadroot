// Boulder projectiles (Elemental Golem). A boulder is launched on a parabolic arc at a chosen
// angle to the player's spot, then obeys real physics: gravity, bounce off terrain + world
// colliders (trees/buildings), and rolling with friction. It damages whatever it touches —
// player AND monsters (even big ones) — full damage on a fast hit, half while rolling. A rolling
// boulder bowls monsters over (strong knockback). Module-level (no React churn); the renderer
// reads getBoulders(); updateBoulders() runs each frame.
import { dealPlayerDamage } from './spray/sprayAttackSystem';
import { sampleHeight } from './terrainHeight';
import { siegeDemons, hurtDemon, type DemonInstance } from './siegeHorde';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';

export const BOULDER_G = 25;     // gravity — MUST match the throw solver
const R = 1;                     // boulder radius (2 m sphere)
const BOUNCE = 0.5;              // restitution
const ROLL_FRICTION = 0.55;      // per-second velocity retention while rolling
const ROLL_SPEED = 6;            // below this horizontal speed (grounded) = rolling
const HIT_KB = 16;               // monster knockback velocity on impact (m/s)

export interface Boulder {
  id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  rolling: boolean; born: number; slowSince: number;
  dmgMin: number; dmgMax: number; kbMin: number; kbMax: number;
  hit: Set<string>;            // demon ids already struck (so it bowls through a horde, one each)
  lastPlayerHit: number;
}
let boulders: Boulder[] = [];
let seq = 0;
export function getBoulders(): Boulder[] { return boulders; }
export function clearBoulders() { boulders = []; }

// Launch from (ox,oy,oz) to land on (tx,ty,tz) at `angleDeg` above horizontal — perfect arc.
export function throwBoulder(
  ox: number, oy: number, oz: number, tx: number, ty: number, tz: number, angleDeg: number,
  opts: { dmgMin?: number; dmgMax?: number; kbMin?: number; kbMax?: number } = {},
) {
  const dx = tx - ox, dz = tz - oz;
  const d = Math.hypot(dx, dz) || 0.001;
  const dirx = dx / d, dirz = dz / d;
  const th = (angleDeg * Math.PI) / 180;
  const denom = (oy - ty) + d * Math.tan(th);
  const v0 = denom > 0.1
    ? Math.sqrt((BOULDER_G * d * d) / (2 * Math.cos(th) ** 2 * denom))
    : Math.sqrt((BOULDER_G * d) / Math.max(0.1, Math.sin(2 * th)));
  const vH = v0 * Math.cos(th), vy = v0 * Math.sin(th);
  boulders.push({
    id: seq++, x: ox, y: oy, z: oz, vx: dirx * vH, vy, vz: dirz * vH,
    rolling: false, born: performance.now(), slowSince: 0,
    dmgMin: opts.dmgMin ?? 50, dmgMax: opts.dmgMax ?? 200, kbMin: opts.kbMin ?? 5, kbMax: opts.kbMax ?? 20,
    hit: new Set(), lastPlayerHit: 0,
  });
}

const hasVox = (x: number, y: number, z: number) => worldCollisionGrid.hasVoxel(Math.floor(x), Math.floor(y), Math.floor(z));

function hitMonster(b: Boulder, d: DemonInstance, dirx: number, dirz: number) {
  const dmg = (b.rolling ? 0.5 : 1) * (b.dmgMin + Math.random() * (b.dmgMax - b.dmgMin));
  hurtDemon(d, dmg);
  // Knockback even big monsters (set velocity directly, bypassing kbScale). Rolling = bowl it over.
  d.kvx = dirx * HIT_KB; d.kvz = dirz * HIT_KB; d.kvy = b.rolling ? 5 : 7;
  d.stunUntil = performance.now() + 700;
  b.hit.add(d.id);
}

export function updateBoulders(dt: number, px: number, py: number, pz: number) {
  if (!boulders.length) return;
  const now = performance.now();
  const keep: Boulder[] = [];
  for (const b of boulders) {
    b.vy -= BOULDER_G * dt;
    let nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;

    // Terrain (mesh) ground — Siege has no voxel floor, so sample the surface.
    const gh = sampleHeight(nx, nz);
    if (gh != null && ny - R <= gh) {
      ny = gh + R;
      if (b.vy < 0) { b.vy = -b.vy * BOUNCE; b.vx *= 0.72; b.vz *= 0.72; }
    }
    // World colliders (trees/buildings inserted as voxel boxes) — per-axis bounce.
    if (b.vy < 0 && hasVox(b.x, ny - R, b.z)) { ny = Math.floor(ny - R) + 1 + R + 0.01; b.vy = -b.vy * BOUNCE; }
    if (b.vx !== 0 && hasVox(b.vx > 0 ? nx + R : nx - R, ny, b.z)) { nx = b.x; b.vx = -b.vx * BOUNCE; }
    if (b.vz !== 0 && hasVox(nx, ny, b.vz > 0 ? nz + R : nz - R)) { nz = b.z; b.vz = -b.vz * BOUNCE; }

    b.x = nx; b.y = ny; b.z = nz;

    // Rolling state + friction.
    const grounded = (gh != null && b.y - R <= gh + 0.15) || Math.abs(b.vy) < 1.5;
    const speed = Math.hypot(b.vx, b.vz);
    b.rolling = grounded && speed < ROLL_SPEED;
    if (b.rolling) {
      const f = Math.pow(ROLL_FRICTION, dt);
      b.vx *= f; b.vz *= f;
      if (gh != null) b.y = gh + R; // hug terrain while rolling
    }

    // Damage: plow through monsters (one hit each), and the player.
    const dirx = speed > 0.01 ? b.vx / speed : 0, dirz = speed > 0.01 ? b.vz / speed : 0;
    const grace = now - b.born < 150;          // don't hit the thrower at launch
    if (!grace) {
      for (const d of siegeDemons) {
        if (d.dead || b.hit.has(d.id)) continue;
        if (Math.hypot(b.x - d.x, b.z - d.z) > R + d.radius) continue;
        if (b.y - R > d.y + d.height || b.y + R < d.y) continue;
        hitMonster(b, d, dirx || (d.x - b.x), dirz || (d.z - b.z));
      }
      // Player (feet at px,py,pz). Rolling can re-hit after a short cooldown.
      if (now - b.lastPlayerHit > 500 && Math.hypot(b.x - px, b.z - pz) <= R + 1
          && b.y - R <= py + 1.7 && b.y + R >= py) {
        const dmg = (b.rolling ? 0.5 : 1) * (b.dmgMin + Math.random() * (b.dmgMax - b.dmgMin));
        const kb = (b.rolling ? 0.5 : 1) * (b.kbMin + Math.random() * (b.kbMax - b.kbMin));
        const kx = dirx || (px - b.x), kz = dirz || (pz - b.z); const kl = Math.hypot(kx, kz) || 1;
        dealPlayerDamage(dmg, kx / kl, 0.15, kz / kl, kb, '/punched.mp3');
        b.lastPlayerHit = now;
      }
    }

    // Cull: rolled to a stop for >1.5s, or too old, or fell away.
    if (b.rolling && speed < 0.6) { if (!b.slowSince) b.slowSince = now; } else b.slowSince = 0;
    const stopped = b.slowSince && now - b.slowSince > 1500;
    if (stopped || now - b.born > 14000 || (gh != null && b.y < gh - 10)) continue;
    keep.push(b);
  }
  boulders = keep;
}
