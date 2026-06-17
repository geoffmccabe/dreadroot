// Spray Attack simulation — a module-level particle pool shared by every spraying
// monster. fireSpray() launches a cone of projectiles; updateSpray() integrates them
// (velocity → gravity), checks the player, applies damage + a velocity-scaled impact
// sound, and culls. The renderer reads getSprayParticles() to draw them.
import * as THREE from 'three';
import type { SprayConfig, SpraySprite } from './sprayConfig';
import { KPH } from './sprayConfig';

export interface SprayParticle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number; r: number; g: number; b: number;
  shape: SpraySprite; ttl: number; cfg: SprayConfig;
}

const particles: SprayParticle[] = [];
const MAX = 1500;

// Player damage is registered by the scene (siege owns takeDamage).
type DamageFn = (dmg: number, dir: THREE.Vector3, knockback: number) => void;
let damageFn: DamageFn | null = null;
export function setSprayDamage(fn: DamageFn | null) { damageFn = fn; }

export function getSprayParticles(): SprayParticle[] { return particles; }

const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Launch a cone of particles from (ox,oy,oz) toward (dx,dy,dz). */
export function fireSpray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cfg: SprayConfig) {
  _f.set(dx, dy, dz).normalize();
  // orthonormal basis around the forward axis
  _u.set(0, 1, 0); if (Math.abs(_f.y) > 0.9) _u.set(1, 0, 0);
  _u.crossVectors(_f, _u).normalize();          // right
  _v.crossVectors(_f, _u).normalize();          // up
  const speed = cfg.speedKph * KPH;
  const cosHalf = Math.cos((cfg.coneDeg * Math.PI) / 180 / 2);
  for (let i = 0; i < cfg.count && particles.length < MAX; i++) {
    // uniform direction inside the cone
    const cz = 1 - Math.random() * (1 - cosHalf);
    const s = Math.sqrt(1 - cz * cz);
    const az = Math.random() * Math.PI * 2;
    _d.copy(_f).multiplyScalar(cz)
      .addScaledVector(_u, Math.cos(az) * s)
      .addScaledVector(_v, Math.sin(az) * s);
    const sp = speed * (1 + (Math.random() * 2 - 1) * cfg.speedVar);
    const t = Math.random();
    particles.push({
      x: ox, y: oy, z: oz,
      vx: _d.x * sp, vy: _d.y * sp, vz: _d.z * sp,
      size: cfg.size * (1 + (Math.random() * 2 - 1) * cfg.sizeVar),
      r: lerp(cfg.colorA[0], cfg.colorB[0], t),
      g: lerp(cfg.colorA[1], cfg.colorB[1], t),
      b: lerp(cfg.colorA[2], cfg.colorB[2], t),
      shape: cfg.sprites[(Math.random() * cfg.sprites.length) | 0],
      ttl: cfg.lifetime, cfg,
    });
  }
}

const _hitDir = new THREE.Vector3();
/** Step the sim. onHit(volume0to1, cfg) fires per player-hit for the impact sound. */
export function updateSpray(dt: number, px: number, py: number, pz: number, onHit: (vol: number, cfg: SprayConfig) => void) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= p.cfg.gravity * dt;
    p.ttl -= dt;
    const ddx = p.x - px, ddy = p.y - py, ddz = p.z - pz;
    if (ddx * ddx + ddy * ddy + ddz * ddz < p.cfg.hitRadius * p.cfg.hitRadius) {
      const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) / KPH; // km/h at impact
      if (damageFn) { _hitDir.set(p.vx, p.vy, p.vz).normalize(); damageFn(p.cfg.damage, _hitDir, 0); }
      onHit(Math.min(1, spd / p.cfg.soundMaxKph), p.cfg);
      particles.splice(i, 1); continue;
    }
    if (p.ttl <= 0) particles.splice(i, 1);
  }
}
