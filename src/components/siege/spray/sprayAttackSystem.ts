// Spray Attack simulation — a module-level particle pool shared by every spraying
// monster. fireSpray() starts an EMITTER that spits a cone of projectiles out over
// cfg.emitWindow seconds (each blob plays a short sound as it leaves the mouth).
// updateSpray() ticks emitters + integrates particles (velocity → gravity), checks
// the player, applies damage, and culls. The renderer reads getSprayParticles().
import * as THREE from 'three';
import type { SprayConfig, SpraySprite } from './sprayConfig';
import { KPH } from './sprayConfig';
import { playSpatialSound } from '@/lib/spatialAudio';
import { recordHit } from '../combatTelemetry';

// Random ±15% playback rate → pitch + length vary together so a repeated impact/roar
// never sounds exactly the same.
const vary = () => 0.85 + Math.random() * 0.30;

export interface SprayParticle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number; opacity: number; r: number; g: number; b: number;
  shape: SpraySprite; ttl: number; cfg: SprayConfig;
}

// A live spray spitting particles out over a time window from a fixed muzzle.
interface SprayEmitter {
  ox: number; oy: number; oz: number;                  // muzzle
  fx: number; fy: number; fz: number;                  // forward axis
  ux: number; uy: number; uz: number;                  // right
  vx: number; vy: number; vz: number;                  // up
  cfg: SprayConfig;
  coneDeg: number;                                     // this shot's spread (normal or broad)
  remaining: number;                                   // particles left to emit
  rate: number;                                        // particles / second
  accum: number;                                       // fractional carry
}

const particles: SprayParticle[] = [];
const emitters: SprayEmitter[] = [];
const MAX = 1500;

// Player damage is registered by the scene (siege owns takeDamage).
type DamageFn = (dmg: number, dir: THREE.Vector3, knockback: number) => void;
let damageFn: DamageFn | null = null;
export function setSprayDamage(fn: DamageFn | null) { damageFn = fn; }

// Direct hit on the player from a melee monster (e.g. the Dark Lord's teleport-strike),
// routed through the same registered player-damage sink as the spray.
const _dmgDir = new THREE.Vector3();
export function dealPlayerDamage(dmg: number, dirX: number, dirY: number, dirZ: number, knockback = 0, hitSound = '/punched.mp3') {
  if (!damageFn) return;
  _dmgDir.set(dirX, dirY, dirZ).normalize();
  // Impact feedback FIRST so it always fires, even if the damage pipeline below throws.
  // (Default = punched; monsters can override, e.g. little_slap; '' = caller plays its own.)
  if (hitSound) void playSpatialSound(hitSound, 0, { baseVolume: 0.7, playbackRate: vary() });
  recordHit(dmg, knockback);   // combat telemetry: stamp this hit with timing + spacing
  try {
    damageFn(dmg, _dmgDir, knockback);
  } catch (e) {
    console.error('[dealPlayerDamage] damage pipeline threw', e);
  }
}

export function getSprayParticles(): SprayParticle[] { return particles; }

const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Start a spray from (ox,oy,oz) toward (dx,dy,dz). Particles emit over cfg.emitWindow. */
let _lastSprayHitAt = 0;
export function getLastSprayHitAt(): number { return _lastSprayHitAt; }

export function fireSpray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cfg: SprayConfig) {
  _f.set(dx, dy, dz).normalize();
  // orthonormal basis around the forward axis
  _u.set(0, 1, 0); if (Math.abs(_f.y) > 0.9) _u.set(1, 0, 0);
  _u.crossVectors(_f, _u).normalize();          // right
  _v.crossVectors(_f, _u).normalize();          // up
  const win = Math.max(0.001, cfg.emitWindow);
  const broad = cfg.broadChance && Math.random() < cfg.broadChance;  // occasional wide, hard-to-dodge spray
  emitters.push({
    ox, oy, oz,
    fx: _f.x, fy: _f.y, fz: _f.z,
    ux: _u.x, uy: _u.y, uz: _u.z,
    vx: _v.x, vy: _v.y, vz: _v.z,
    cfg, coneDeg: broad ? (cfg.broadConeDeg ?? cfg.coneDeg) : cfg.coneDeg,
    remaining: cfg.count, rate: cfg.count / win, accum: 0,
  });
}

/** Emit ONE particle from an emitter's muzzle. Returns the muzzle speed (km/h). */
function emitOne(em: SprayEmitter): number {
  const cfg = em.cfg;
  const speed = cfg.speedKph * KPH;
  const cosHalf = Math.cos((em.coneDeg * Math.PI) / 180 / 2);
  // uniform direction inside the cone
  const cz = 1 - Math.random() * (1 - cosHalf);
  const s = Math.sqrt(1 - cz * cz);
  const az = Math.random() * Math.PI * 2;
  const ca = Math.cos(az) * s, sa = Math.sin(az) * s;
  const dx = em.fx * cz + em.ux * ca + em.vx * sa;
  const dy = em.fy * cz + em.uy * ca + em.vy * sa;
  const dz = em.fz * cz + em.uz * ca + em.vz * sa;
  const sp = speed * (1 + (Math.random() * 2 - 1) * cfg.speedVar);
  const t = Math.random();
  particles.push({
    x: em.ox, y: em.oy, z: em.oz,
    vx: dx * sp, vy: dy * sp, vz: dz * sp,
    size: cfg.size * (1 + (Math.random() * 2 - 1) * cfg.sizeVar),
    opacity: lerp(cfg.opacityMin, cfg.opacityMax, Math.random()),
    r: lerp(cfg.colorA[0], cfg.colorB[0], t),
    g: lerp(cfg.colorA[1], cfg.colorB[1], t),
    b: lerp(cfg.colorA[2], cfg.colorB[2], t),
    shape: cfg.sprites[(Math.random() * cfg.sprites.length) | 0],
    ttl: cfg.lifetime, cfg,
  });
  return sp / KPH;
}

const _hitDir = new THREE.Vector3();
/** Step the sim. onEmit fires per blob leaving the mouth; onHit fires per blob striking the player. */
export function updateSpray(
  dt: number, px: number, py: number, pz: number,
  onEmit: (vol: number, cfg: SprayConfig) => void,
  onHit: (cfg: SprayConfig) => void,
) {
  // 1. Emitters spit particles out over their window.
  for (let e = emitters.length - 1; e >= 0; e--) {
    const em = emitters[e];
    em.accum += em.rate * dt;
    let n = Math.floor(em.accum);
    em.accum -= n;
    while (n > 0 && em.remaining > 0 && particles.length < MAX) {
      const kph = emitOne(em);
      onEmit(Math.min(1, kph / em.cfg.soundMaxKph), em.cfg);
      em.remaining--; n--;
    }
    if (em.remaining <= 0) emitters.splice(e, 1);
  }
  // 2. Integrate live particles; damage the player on contact.
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= p.cfg.gravity * dt;
    p.ttl -= dt;
    const ddx = p.x - px, ddy = p.y - py, ddz = p.z - pz;
    if (ddx * ddx + ddy * ddy + ddz * ddz < p.cfg.hitRadius * p.cfg.hitRadius) {
      if (damageFn) { _hitDir.set(p.vx, p.vy, p.vz).normalize(); damageFn(p.cfg.damage, _hitDir, 0); }
      _lastSprayHitAt = performance.now();   // so a sprayer can tell its breath connected (→ wide-arc retry)
      onHit(p.cfg);
      particles.splice(i, 1); continue;
    }
    if (p.ttl <= 0) particles.splice(i, 1);
  }
}
