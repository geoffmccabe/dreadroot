// Blood spray — a cross-game (SWW / DreadRoot / Pinkland) particle burst for
// bullseye hits. Modeled on the vomit-demon spray (module pool + emit/update/get,
// instanced rendering in BloodRenderer) but tuned for blood: elongated teardrops
// that erupt from the EXIT side of the hit, fly at half the bullet speed in a tight
// cone, decelerate HARD under air drag then fall, and leave fading decals where
// they land.
//
// Per-monster config (color/opacity/size/etc.) lets a robot bleed translucent
// golden-green, a demon boss bleed opaque black, etc. Default = red, ~70% opaque.

export interface BloodConfig {
  color: [number, number, number];   // RGB 0-1
  opacity: number;                    // 0-1
  count: number;                      // droplets per burst
  speedFactor: number;                // fraction of the bullet's speed
  speedVar: number;                   // ± fraction on speed
  coneDeg: number;                    // full spray cone (solid angle)
  teardropRatio: number;              // length : width (8 = 8× longer than wide)
  dropletSize: number;                // base half-width (m)
  sizeVar: number;                    // ± size fraction
  gravity: number;                    // m/s²
  dragK: number;                      // quadratic air-drag coeff (1/m) — high = stops fast
  decalSize: number;                  // landed-decal radius (m)
  fadeSeconds: number;                // droplet + decal fade (s)
}

export const DEFAULT_BLOOD: BloodConfig = {
  color: [0.55, 0.0, 0.0],   // blood red
  opacity: 0.7,
  count: 100,
  speedFactor: 0.5,
  speedVar: 0.35,
  coneDeg: 25,
  teardropRatio: 8,
  dropletSize: 0.035,
  sizeVar: 0.5,
  gravity: 13,
  dragK: 0.5,                // ~30→5 m/s in ~0.3s, terminal ~5 m/s
  decalSize: 0.18,
  fadeSeconds: 10,
};

export interface BloodDroplet {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number; r: number; g: number; b: number; opacity: number;
  ratio: number; born: number; life: number; alive: boolean;
}
export interface BloodDecal {
  x: number; y: number; z: number;        // on the surface
  nx: number; ny: number; nz: number;     // surface normal
  dirx: number; dirz: number;             // horizontal flight dir (teardrop points along it)
  size: number; r: number; g: number; b: number; opacity: number;
  born: number; fade: number; kind: 'ground' | 'mesh';
}

const droplets: BloodDroplet[] = [];
const decals: BloodDecal[] = [];
const MAX_DROPLETS = 1200;
const MAX_DECALS = 400;

export function getBloodDroplets(): BloodDroplet[] { return droplets; }
export function getBloodDecals(): BloodDecal[] { return decals; }

function nowS(): number { return performance.now() / 1000; }

/** Erupt `cfg.count` droplets from (x,y,z) along (dx,dy,dz) at speedFactor× the
 *  bullet speed, scattered in a coneDeg cone. */
export function emitBlood(
  x: number, y: number, z: number,
  dx: number, dy: number, dz: number,
  bulletSpeed: number, cfg: BloodConfig = DEFAULT_BLOOD,
): void {
  const dmag = Math.hypot(dx, dy, dz) || 1;
  const fx = dx / dmag, fy = dy / dmag, fz = dz / dmag;
  // Perpendicular basis around the flight direction.
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(fy) > 0.95) { ux = 1; uy = 0; uz = 0; }
  let rx = uy * fz - uz * fy, ry = uz * fx - ux * fz, rz = ux * fy - uy * fx;   // right = up × f
  const rmag = Math.hypot(rx, ry, rz) || 1; rx /= rmag; ry /= rmag; rz /= rmag;
  const u2x = fy * rz - fz * ry, u2y = fz * rx - fx * rz, u2z = fx * ry - fy * rx;   // f × right
  const half = (cfg.coneDeg * Math.PI / 180) / 2;
  const baseSpeed = bulletSpeed * cfg.speedFactor;
  const t = nowS();

  for (let i = 0; i < cfg.count; i++) {
    if (droplets.length >= MAX_DROPLETS) break;
    // Uniform-in-cone direction.
    const cosA = 1 - Math.random() * (1 - Math.cos(half));
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const phi = Math.random() * Math.PI * 2;
    const cx = sinA * Math.cos(phi), cy = sinA * Math.sin(phi);
    const ddx = rx * cx + u2x * cy + fx * cosA;
    const ddy = ry * cx + u2y * cy + fy * cosA;
    const ddz = rz * cx + u2z * cy + fz * cosA;
    const sp = baseSpeed * (1 + (Math.random() * 2 - 1) * cfg.speedVar);
    const size = cfg.dropletSize * (1 + (Math.random() * 2 - 1) * cfg.sizeVar);
    const tint = 0.85 + Math.random() * 0.3;
    droplets.push({
      x, y, z,
      vx: ddx * sp, vy: ddy * sp, vz: ddz * sp,
      size, r: Math.min(1, cfg.color[0] * tint), g: Math.min(1, cfg.color[1] * tint), b: Math.min(1, cfg.color[2] * tint),
      opacity: cfg.opacity, ratio: cfg.teardropRatio,
      born: t, life: cfg.fadeSeconds, alive: true,
    });
  }
}

/** Step the sim. groundYAt(x,z) → terrain height (or null off-map). meshHit(...) is
 *  an optional ray-vs-mesh test for landing on monsters/trees/rocks (added later). */
export function updateBlood(
  dt: number,
  cfg: BloodConfig,
  groundYAt?: (x: number, z: number) => number | null,
): void {
  const t = nowS();
  // Droplets.
  for (let i = droplets.length - 1; i >= 0; i--) {
    const p = droplets[i];
    if (!p.alive) { droplets.splice(i, 1); continue; }
    // Quadratic air drag (decelerate hard) + gravity.
    const sp = Math.hypot(p.vx, p.vy, p.vz);
    const k = cfg.dragK * sp * dt;
    p.vx -= p.vx * k; p.vy -= p.vy * k; p.vz -= p.vz * k;
    p.vy -= cfg.gravity * dt;
    const ox = p.x, oy = p.y, oz = p.z;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    // Ground landing → decal.
    const gy = groundYAt ? groundYAt(p.x, p.z) : 0;
    if (gy != null && p.y <= gy) {
      if (decals.length < MAX_DECALS) {
        const hdir = Math.hypot(p.vx, p.vz) || 1;
        decals.push({
          x: p.x, y: gy + 0.02, z: p.z, nx: 0, ny: 1, nz: 0,
          dirx: p.vx / hdir, dirz: p.vz / hdir,
          size: cfg.decalSize * (0.6 + Math.random() * 0.8),
          r: p.r, g: p.g, b: p.b, opacity: cfg.opacity,
          born: t, fade: cfg.fadeSeconds, kind: 'ground',
        });
      }
      p.alive = false; droplets.splice(i, 1); continue;
    }
    // Expire by lifetime.
    if (t - p.born > p.life) { droplets.splice(i, 1); continue; }
    void ox; void oy; void oz;
  }
  // Decals fade out over `fade` seconds.
  for (let i = decals.length - 1; i >= 0; i--) {
    if (t - decals[i].born > decals[i].fade) decals.splice(i, 1);
  }
}

export function clearBlood(): void { droplets.length = 0; decals.length = 0; }
