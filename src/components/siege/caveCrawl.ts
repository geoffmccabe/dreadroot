// caveCrawl — opt-in behaviour for big bipeds: when the player hides in a space too small for the
// monster's body, it drops to a crawl (stand→crouch→crawl), threads in with its head bent UP toward
// the player (the crawl clip faces the floor), and — if it wedges where even crawling won't fit —
// reaches in with a swipe. Pure helpers + a tiny state machine; MonsterEnemy owns the per-instance
// state object and calls these. GAME-AGNOSTIC (no SWW specifics) so Dreadroot enemies can reuse it.
//
// SENSES-SEAM: this consumes the target the senses window resolves (acquireTarget) — it only decides
// the locomotion/attack RESPONSE once a target exists. It does NOT decide detection/awareness.
import * as THREE from 'three';
import { pathFits, FIT_STAND, FIT_CRAWL, type PathPt } from './siegePathfinding';

export interface CaveCrawlConfig {
  shrink?: number;        // fit-test the collider at this fraction of its radius (0.85 = 15% smaller)
  crawlSpeedMul?: number; // crawl move speed vs walk
  neckBendDeg?: number;   // total head-UP bend while crawling (deg, split across the neck bones)
  transitionMs?: number;  // how long the stand→crouch transition plays before the crawl
  swipeMs?: number;       // wedged: deal one reach-in swipe this often (ms)
}
export const CC_DEF: Required<CaveCrawlConfig> = {
  shrink: 0.85, crawlSpeedMul: 0.9, neckBendDeg: 55, transitionMs: 450, swipeMs: 1100,
};
export const ccCfg = (c?: CaveCrawlConfig): Required<CaveCrawlConfig> => ({ ...CC_DEF, ...(c ?? {}) });

export type CavePosture = 'walk' | 'crawl' | 'wedged';
export type CaveMode = 'none' | 'enter' | 'crawl' | 'wedged';

export interface CaveState { mode: CaveMode; enterAt: number; lastSwipe: number; }
export const newCaveState = (): CaveState => ({ mode: 'none', enterAt: 0, lastSwipe: 0 });

/** Can this body (half-width = radius·shrink) WALK the active route, must it CRAWL, or is it WEDGED
 *  (even crawling won't pass)? A "duck-in" opening fails the upright test but passes the crawl test. */
export function resolveCavePosture(path: PathPt[] | null, sx: number, sz: number, refY: number, radius: number, shrink: number): CavePosture {
  if (!path || !path.length) return 'walk';
  const clear = radius * shrink;
  if (pathFits(path, sx, sz, refY, clear, FIT_STAND)) return 'walk';
  if (pathFits(path, sx, sz, refY, clear, FIT_CRAWL)) return 'crawl';
  return 'wedged';
}

/** Advance the cave-crawl state machine one frame. Returns the mode to act on. */
export function stepCave(st: CaveState, posture: CavePosture, active: boolean, now: number, transitionMs: number): CaveMode {
  if (!active || posture === 'walk') { st.mode = 'none'; return 'none'; }
  if (st.mode === 'none') { st.mode = 'enter'; st.enterAt = now; }            // begin: play stand→crouch
  if (st.mode === 'enter' && now - st.enterAt >= transitionMs) st.mode = 'crawl';
  if (st.mode === 'crawl' || st.mode === 'wedged') st.mode = posture === 'wedged' ? 'wedged' : 'crawl';
  return st.mode;
}

/** Neck bones (Synty 'Neck', UE 'neck_01', 'Neck1'…), parent-first by name. */
export function findNeckBones(root: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  root.traverse((o) => { if ((o as unknown as THREE.Bone).isBone && /neck/i.test(o.name)) out.push(o as unknown as THREE.Bone); });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Lift a face-down crawl head toward the player. Premultiplied onto the ANIMATED pose each frame
// (call AFTER the mixer updates), rest-compensated like the headshot waist-bend, around the model's
// world-space "right" axis so it's correct regardless of the rig's baked bone orientation.
const _gwq = new THREE.Quaternion(), _right = new THREE.Vector3(), _delta = new THREE.Quaternion(), _pwq = new THREE.Quaternion(), _loc = new THREE.Quaternion();
export function applyHeadUp(modelRoot: THREE.Object3D, neck: THREE.Bone[], totalDeg: number) {
  if (!neck.length || !totalDeg) return;
  const per = (totalDeg * Math.PI / 180) / neck.length;
  modelRoot.getWorldQuaternion(_gwq);
  _right.set(1, 0, 0).applyQuaternion(_gwq).normalize();
  _delta.setFromAxisAngle(_right, -per);   // -per lifts the face UP (same sense as the head-back lean)
  for (const b of neck) {
    const p = b.parent; if (!p) continue;
    p.getWorldQuaternion(_pwq);
    _loc.copy(_pwq).invert().multiply(_delta).multiply(_pwq);
    b.quaternion.premultiply(_loc);
  }
}
