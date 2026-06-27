// Dark Lord lightning attack — behavior + the VFX bridge. Electricity streams from BOTH hands to
// the player, stops at the first wall/rock/tree (line of sight), and burns 10-50 dmg/s with a
// 100%→0% falloff over 15 m. The bolts themselves are drawn by <DarkLordLightning> (three.js
// LightningStrike); this module owns the timing/damage and publishes the live endpoints.
//
// Rules (per Geoff):
//  • 15 m max range, damage falls off 100%→0% with distance.
//  • 10-50 dmg every full second the player is in the stream (with line of sight).
//  • The first second is a GRACE window: if the Dark Lord is shot during it, the bolt fizzles
//    (no damage) — so you can react and shoot him. Once it's burned ≥1 s it commits.
//  • Full power regardless of his transparency.
//  • A bout lasts up to 5 s; after a >5 s bout he must RECHARGE 10 s (teleport 30-50 m away,
//    rest, then resume) — the teleporter branch handles the jump when we flag it.
import * as THREE from 'three';
import { raycastMesh } from '../meshColliderSystem';
import { dealPlayerDamage } from '../spray/sprayAttackSystem';

export const LIGHTNING_RANGE = 15;
const MAX_BOUT_MS = 5000;
const REACT_GRACE_MS = 1000;
const TICK_MS = 1000;

// ── VFX bridge: each active caster publishes 2 hand origins + the (clipped) beam end ──
export interface LightningBeam { ax: number; ay: number; az: number; bx: number; by: number; bz: number; ex: number; ey: number; ez: number; }
const casters = new Map<string, LightningBeam>();
export function getLightningCasters(): Map<string, LightningBeam> { return casters; }
export function clearLightningCaster(id: string): void { casters.delete(id); }

// Per-Dark-Lord lightning runtime state (stored on the monster's `s` ref via these fields).
export interface LightningState {
  liteActive: boolean; liteStart: number; liteOnSince: number; liteTick: number;
  liteRoll: number; rechargeUntil: number;
}
export function initLightning(s: LightningState): void {
  s.liteActive = false; s.liteStart = 0; s.liteOnSince = 0; s.liteTick = 0; s.liteRoll = 0; s.rechargeUntil = 0;
}

const _dir = new THREE.Vector3();

/** Drive the lightning each frame. Returns whether he's actively casting (so the renderer holds the
 *  cast pose + skips shambling) and whether a >5 s bout just ended (→ recharge teleport). */
export function tickDarkLordLightning(
  id: string, s: LightningState, hitAt: number, damageMul: number, now: number,
  px: number, py: number, pz: number,
  hl: THREE.Vector3, hr: THREE.Vector3,
): { casting: boolean; recharge: boolean } {
  // Midpoint of the hands = beam origin for the LOS check.
  const ox = (hl.x + hr.x) / 2, oy = (hl.y + hr.y) / 2, oz = (hl.z + hr.z) / 2;
  const ddx = px - ox, ddy = (py - 0.8) - oy, ddz = pz - oz;         // aim at the player's torso
  const dist = Math.hypot(ddx, ddy, ddz);
  // Line of sight: stop the beam at the first wall/rock. clipDist = how far the beam reaches.
  _dir.set(ddx, ddy, ddz).normalize();
  const wall = dist > 1e-3 ? raycastMesh(ox, oy, oz, _dir.x, _dir.y, _dir.z, Math.min(dist, LIGHTNING_RANGE)) : null;
  const reach = wall != null ? wall : Math.min(dist, LIGHTNING_RANGE);
  const blocked = wall != null && wall < dist - 0.1;                 // a surface is between us
  const ex = ox + _dir.x * reach, ey = oy + _dir.y * reach, ez = oz + _dir.z * reach;

  if (s.liteActive) {
    casters.set(id, { ax: hl.x, ay: hl.y, az: hl.z, bx: hr.x, by: hr.y, bz: hr.z, ex, ey, ez });
    const inStream = !blocked && dist <= LIGHTNING_RANGE;
    if (inStream) {
      if (!s.liteOnSince) s.liteOnSince = now;
      const onDur = now - s.liteOnSince;
      // Grace window: a fresh hit on the Dark Lord fizzles the bolt before it commits (<1 s).
      if (onDur < REACT_GRACE_MS && hitAt && now - hitAt < 250) {
        s.liteActive = false; casters.delete(id); return { casting: false, recharge: false };
      }
      if (onDur >= REACT_GRACE_MS && now - s.liteTick >= TICK_MS) {
        s.liteTick = now;
        const fall = Math.max(0, 1 - dist / LIGHTNING_RANGE);         // 100%→0% over 15 m
        const dmg = (10 + Math.random() * 40) * fall * (damageMul || 1);
        if (dmg > 0) dealPlayerDamage(dmg, ddx / dist, 0, ddz / dist, 0, '', 'Dark Lord');   // no zap sound asset yet
      }
    } else {
      s.liteOnSince = 0;                                              // broke LOS / out of range → reset the grace
    }
    if (now - s.liteStart >= MAX_BOUT_MS) {                           // bout maxed → recharge
      s.liteActive = false; casters.delete(id); s.rechargeUntil = now + 10000;
      return { casting: false, recharge: true };
    }
    return { casting: true, recharge: false };
  }
  casters.delete(id);
  return { casting: false, recharge: false };
}

/** Roll the 40%/s chance to START a bout (when in range, line of sight clear, not recharging). */
export function tryStartLightning(s: LightningState, now: number, px: number, py: number, pz: number, hl: THREE.Vector3, hr: THREE.Vector3): boolean {
  if (now < s.rechargeUntil || now < s.liteRoll) return false;
  s.liteRoll = now + 1000;                                            // one roll per second
  const ox = (hl.x + hr.x) / 2, oy = (hl.y + hr.y) / 2, oz = (hl.z + hr.z) / 2;
  const ddx = px - ox, ddy = (py - 0.8) - oy, ddz = pz - oz;
  const dist = Math.hypot(ddx, ddy, ddz);
  if (dist > LIGHTNING_RANGE) return false;
  _dir.set(ddx, ddy, ddz).normalize();
  const wall = raycastMesh(ox, oy, oz, _dir.x, _dir.y, _dir.z, dist);
  if (wall != null && wall < dist - 0.1) return false;               // no LOS
  if (Math.random() >= 0.40) return false;                           // 40% chance
  s.liteActive = true; s.liteStart = now; s.liteOnSince = 0; s.liteTick = now;
  return true;
}
