// Static merged geometries for the eyelash assembly and the bent
// mandible.
//
// Authoring frame matches the shpider's local body frame:
//   +Z = outward from face (forward of the head)
//   +Y = up (toward the sky / toward surfaceNormal)
//   +X = right
//
// Both geometries are built once at module load.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ──────────────────────────────────────────────────────────────────────
//  Eyelashes
// ──────────────────────────────────────────────────────────────────────
//
// 12 lashes, each:
//   - Base point on the face plane (Z=0), distributed along a wide
//     upper-eyelid arc across the front of the head.
//   - Extends forward (+Z) and curves upward (+Y) — like a real
//     eyelash sweeping out and up.
//   - Cone tip at the end, oriented along the curve's end tangent
//     so it reads as a continuation of the tube, not perpendicular.
//
// The arc shape: an inverted-smile / brow shape — middle base is the
// highest, edge bases are slightly lower.
//
const EYELASH_COUNT       = 12;
const EYELASH_ARC_SPREAD  = Math.PI * 0.75;   // ~135° fan across face
const EYELASH_ARC_RADIUS  = 0.40;             // half-width of face arc
const EYELASH_ARC_BASE_Y  = 0.05;             // upper-face Y baseline (above face center)
const EYELASH_TUBE_R      = 0.022;            // lash thickness
const EYELASH_TIP_R       = 0.025;            // cone tip base radius (matches tube)
const EYELASH_TIP_LEN     = 0.13;             // cone tip length
const EYELASH_CURVE_LEN   = 0.42;             // approximate length of the curved part

function buildEyelashAssembly(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < EYELASH_COUNT; i++) {
    // theta sweeps from -spread/2 (far left) to +spread/2 (far right)
    const t = (i + 0.5) / EYELASH_COUNT;
    const theta = -EYELASH_ARC_SPREAD / 2 + t * EYELASH_ARC_SPREAD;
    const baseX = Math.sin(theta) * EYELASH_ARC_RADIUS;
    // Inverted-smile arc — middle higher, edges lower.
    const baseY = EYELASH_ARC_BASE_Y + Math.cos(theta) * 0.10;

    // Cubic bezier from face outward + upward.
    // Start: on face plane (Z=0).
    // Two control points push the curve outward first, then up.
    // End: above and slightly outward — gives the classic eyelash sweep.
    const start = new THREE.Vector3(baseX, baseY,                       0);
    const ctrl1 = new THREE.Vector3(baseX, baseY + 0.03,                EYELASH_CURVE_LEN * 0.45);
    const ctrl2 = new THREE.Vector3(baseX, baseY + EYELASH_CURVE_LEN * 0.55, EYELASH_CURVE_LEN * 0.85);
    const end   = new THREE.Vector3(baseX, baseY + EYELASH_CURVE_LEN,   EYELASH_CURVE_LEN * 0.60);

    const curve = new THREE.CubicBezierCurve3(start, ctrl1, ctrl2, end);

    // Tube along the curve.
    const tube = new THREE.TubeGeometry(curve, 10, EYELASH_TUBE_R, 5, false);
    parts.push(tube);

    // Cone tip at the end of the curve, oriented along the end tangent
    // so it visually continues the tube.
    const tangent = curve.getTangent(1).normalize();
    const cone = new THREE.ConeGeometry(EYELASH_TIP_R, EYELASH_TIP_LEN, 8);
    // ConeGeometry's base is at -Y/2 and tip at +Y/2. Translate so the
    // base sits at the origin, tip along +Y.
    cone.translate(0, EYELASH_TIP_LEN / 2, 0);
    // Rotate +Y → tangent direction.
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    cone.applyQuaternion(q);
    // Move the cone's base to the curve's end point.
    cone.translate(end.x, end.y, end.z);
    parts.push(cone);
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  if (!merged) {
    console.warn('[Shpider] Eyelash merge failed; returning empty geometry');
    return new THREE.BufferGeometry();
  }
  return merged;
}

// ──────────────────────────────────────────────────────────────────────
//  Mandible
// ──────────────────────────────────────────────────────────────────────
//
// A bent cone pointing forward (+Z) in local space. Wider segment near
// the face, thinner curved segment at the tip. Built as ONE mandible —
// the renderer instances it twice per shpider, mirroring one via -X
// scale and splaying around local +Y so they fan / click together.
//
const MAND_BASE_LEN  = 0.28;
const MAND_BASE_R    = 0.07;
const MAND_TIP_LEN   = 0.22;
const MAND_TIP_R     = 0.025;
const MAND_BEND_RAD  = Math.PI * 0.18; // ~32° inward bend at the joint

function buildMandible(): THREE.BufferGeometry {
  // Base segment: a cone whose wide end sits at the face (origin) and
  // whose narrow tip points forward (+Z).
  const base = new THREE.ConeGeometry(MAND_BASE_R, MAND_BASE_LEN, 10);
  // ConeGeometry: tip at +Y/2, base at -Y/2. rotateX(+π/2) maps +Y→+Z,
  // so after this the tip is at +Z/2 and the base circle at -Z/2.
  base.rotateX(Math.PI / 2);
  // Slide forward so the base circle is at z=0 and tip at z=BASE_LEN.
  base.translate(0, 0, MAND_BASE_LEN / 2);

  // Tip segment: a thinner cone that starts at the base segment's tip
  // and bends inward (rotation around Y so the tip drifts toward +X).
  const tip = new THREE.ConeGeometry(MAND_TIP_R, MAND_TIP_LEN, 8);
  tip.rotateX(Math.PI / 2);
  tip.translate(0, 0, MAND_TIP_LEN / 2);
  // Bend before relocating — pivots around the tip cone's own base.
  tip.rotateY(MAND_BEND_RAD);
  // Slot the bent tip onto the end of the base segment.
  tip.translate(0, 0, MAND_BASE_LEN);

  const merged = mergeGeometries([base, tip], false);
  base.dispose();
  tip.dispose();
  if (!merged) {
    console.warn('[Shpider] Mandible merge failed; returning empty geometry');
    return new THREE.BufferGeometry();
  }
  return merged;
}

export const EYELASH_GEOMETRY  = buildEyelashAssembly();
export const MANDIBLE_GEOMETRY = buildMandible();

// Per-shpider mandible animation settings.
export const MANDIBLE_OPEN_ANGLE             = Math.PI * 0.36; // ~65° splay at rest (was 0.18 — doubled per design)
export const MANDIBLE_CLICK_DURATION_MS      = 160;
export const MANDIBLE_MIN_CLICK_INTERVAL_MS  = 600;
export const MANDIBLE_MAX_CLICK_INTERVAL_MS  = 1800;
