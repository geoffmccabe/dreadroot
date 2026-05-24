// Static merged geometries for the eyelash assembly and the bent
// mandible. Both are built once at module load and shared across all
// shpider instances via InstancedMesh; per-shpider positioning happens
// in the renderer's matrix updates.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const EYELASH_COUNT = 12;

/**
 * One eyelash = curved tube (segment of a torus) + sharp cone tip at
 * the outer end. The whole assembly hangs as 12 lashes in a wide arc
 * along the front face of the shpider's head, lashes radiating
 * downward + outward to fan around the texture's central eye.
 *
 * Units are in *head-radius* space (head is 1 unit cube → radius 0.5),
 * so the geometry scales naturally with head size when applied via
 * instance matrix.
 */
function buildEyelashAssembly(): THREE.BufferGeometry {
  const lashRadius     = 0.45;  // curve radius (how curled the lash is)
  const lashTubeR      = 0.025; // thickness of the lash tube
  const lashArc        = Math.PI * 0.55; // how much of the torus we use
  const tipLength      = 0.18;
  const tipRadius      = 0.03;
  const arcSpread      = Math.PI * 0.95; // how wide the 12-lash fan reaches
  const arcStart       = -arcSpread / 2;

  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < EYELASH_COUNT; i++) {
    const lashAngle = arcStart + (i / (EYELASH_COUNT - 1)) * arcSpread;

    // 1) Curved tube (partial torus).
    // TorusGeometry sits in the XY plane with its hole on +Z. We rotate
    // it so its open arc reaches outward from the head's front face.
    const tube = new THREE.TorusGeometry(lashRadius, lashTubeR, 6, 12, lashArc);
    // Rotate so the lash's "base" sits near the head and the tip points
    // away from the eye, along the +Y direction relative to the lash.
    tube.rotateZ(-Math.PI / 2);   // align the arc plane to vertical
    tube.rotateY(lashAngle);      // fan around the eye

    // 2) Cone tip at the outer end of the tube arc.
    const tip = new THREE.ConeGeometry(tipRadius, tipLength, 8);
    // Position at the world-end of the arc — torus center is origin,
    // arc length = lashArc, end = (cos(arc), sin(arc)) in the rotated
    // plane. After the rotateZ + rotateY above, compute end:
    const endLocalX = Math.cos(lashArc) * lashRadius;
    const endLocalY = Math.sin(lashArc) * lashRadius;
    // Apply same rotateZ + rotateY transforms to the local end point.
    // rotateZ(-π/2): (x, y, z) → (y, -x, z)
    let ex = endLocalY;
    let ey = -endLocalX;
    let ez = 0;
    // rotateY(lashAngle): (x, y, z) → (x cos + z sin, y, -x sin + z cos)
    const ca = Math.cos(lashAngle);
    const sa = Math.sin(lashAngle);
    const ex2 =  ex * ca + ez * sa;
    const ez2 = -ex * sa + ez * ca;
    ex = ex2;
    ez = ez2;
    tip.translate(ex, ey - tipLength * 0.5, ez);
    // Orient the cone so its tip points away from the head.
    tip.rotateZ(-lashAngle);

    parts.push(tube);
    parts.push(tip);
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  if (!merged) {
    console.warn('[Shpider] Eyelash merge failed; returning empty geometry');
    return new THREE.BufferGeometry();
  }
  return merged;
}

/**
 * One mandible = bent cone. Two cone segments stitched together: a
 * wider "base" cone + a narrower "tip" cone, the second tipped inward
 * at an angle. Approximates the curved-mandible look without needing
 * custom vertex math.
 *
 * Built with the base at origin, opening along +Y, tip curving inward
 * toward +X (so the LEFT mandible uses this geo as-is and the RIGHT
 * mandible just mirrors the X scale).
 */
function buildMandible(): THREE.BufferGeometry {
  const baseLength = 0.28;
  const baseRadius = 0.06;
  const tipLength  = 0.22;
  const tipRadius  = 0.025;
  const tipBendAngle = Math.PI * 0.25; // 45° inward at the joint

  const base = new THREE.ConeGeometry(baseRadius, baseLength, 8);
  // ConeGeometry has its tip at +Y/2 and base at -Y/2. Move so the
  // base sits at origin pointing down (apex pointing away from head).
  base.translate(0, -baseLength / 2, 0);

  const tip = new THREE.ConeGeometry(tipRadius, tipLength, 8);
  // Tip starts where the base ends; rotate it inward by tipBendAngle.
  tip.translate(0, -tipLength / 2, 0);
  tip.rotateZ(-tipBendAngle);            // bend toward +X
  tip.translate(0, -baseLength, 0);      // shift down to the base's end

  const merged = mergeGeometries([base, tip], false);
  base.dispose();
  tip.dispose();
  if (!merged) {
    console.warn('[Shpider] Mandible merge failed; returning empty geometry');
    return new THREE.BufferGeometry();
  }
  return merged;
}

export const EYELASH_GEOMETRY = buildEyelashAssembly();
export const MANDIBLE_GEOMETRY = buildMandible();

export const MANDIBLE_OPEN_ANGLE = Math.PI * 0.15;  // ~27° splay at rest
export const MANDIBLE_CLICK_DURATION_MS = 160;
export const MANDIBLE_MIN_CLICK_INTERVAL_MS = 600;
export const MANDIBLE_MAX_CLICK_INTERVAL_MS = 1800;
