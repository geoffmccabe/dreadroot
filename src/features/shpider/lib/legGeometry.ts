// Shared shpider leg-segment math. Used by both ShpiderRenderer
// (full instanced shpiders in the world) and WorldEggRenderer
// (single mini-shpider inside each unhatched egg). Same animation
// inputs produce the same leg pose, so the mini-shpider walks
// identically to the big ones at smaller scale.

import * as THREE from 'three';
import { LEGS_PER_SHPIDER } from '../constants';

/**
 * Local-space endpoints for a leg segment. Returns ONE leg segment in
 * the body's local frame (Y up, Z forward, X right).
 *
 * Resting pose: shoulder on body surface (y=0), foot exactly on the
 * supporting surface (y = -halfBody). Vertical extent is constrained
 * to halfBody so legs can't punch through the wall the shpider is on.
 *
 * Animations layered on top:
 *  - Idle bob: small vertical bob on each leg's own phase.
 *  - Hop:      tuck inward at apex, splay outward on landing.
 *  - Crawl:    walking gait — each leg lifts vertically (away from
 *              surface) on its own random freq/amp/phase so individual
 *              legs step at different rates. Foot pivots upward from
 *              its rest position toward the shoulder anchor; ankle
 *              and elbow follow proportionally.
 */
export function getSegmentEndpoints(
  legIdx: number,
  segmentIdx: number,
  bodySize: number,
  hopT: number | null,
  crawlT: number | null,
  legPhase: number,
  legFreq: number,
  legLiftAmp: number,
  time: number,
  out: { start: THREE.Vector3; end: THREE.Vector3 },
): void {
  const a = (legIdx / LEGS_PER_SHPIDER) * Math.PI * 2 + 0.1;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const half = bodySize * 0.5;

  let tuck = 0, splay = 0;
  if (hopT != null) {
    tuck  = Math.sin(Math.PI * hopT) * 0.45;
    splay = hopT > 0.75 ? (hopT - 0.75) * 4 * 0.25 : 0;
  }
  const outMul = 1 - tuck + splay;
  const downMul = 1 - tuck * 0.6 + splay * 0.3;

  let stepLift = 0;
  if (crawlT != null) {
    const phase = Math.sin(time * 2.4 * legFreq + legPhase);
    stepLift = Math.max(0, phase) * legLiftAmp * half;
  }
  const idleBob = Math.sin(time * 1.5 + legPhase) * 0.02 * half;
  const lift = stepLift + idleBob;

  const shoulderX = cosA * half;
  const shoulderZ = sinA * half;
  const shoulderY = 0;

  const elbowX = cosA * half * 1.6 * outMul;
  const elbowZ = sinA * half * 1.6 * outMul;
  const elbowY = -half * 0.30 * downMul + lift * 0.25;

  const ankleX = cosA * half * 2.0 * outMul;
  const ankleZ = sinA * half * 2.0 * outMul;
  const ankleY = -half * 0.75 * downMul + lift * 0.65;

  const footX = cosA * half * 2.1 * outMul;
  const footZ = sinA * half * 2.1 * outMul;
  const footY = -half * downMul + lift;

  if (segmentIdx === 0) {
    out.start.set(shoulderX, shoulderY, shoulderZ);
    out.end.set(elbowX, elbowY, elbowZ);
  } else if (segmentIdx === 1) {
    out.start.set(elbowX, elbowY, elbowZ);
    out.end.set(ankleX, ankleY, ankleZ);
  } else {
    out.start.set(ankleX, ankleY, ankleZ);
    out.end.set(footX, footY, footZ);
  }
}

/** Head-slide rate — head oscillates forward/back at this many Hz.
 *  Mirrors HEAD_SLIDE_HZ in ShpiderRenderer. */
export const HEAD_SLIDE_HZ = 1.1;
