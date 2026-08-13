// KaijuParachutes — fifty canopies, one draw call.
//
// Geoff: "The parachute will be a section of a flattened cylinder above the paratrooper, which will
// be 8m diameter around the paratrooper, but only the 45 degrees directly above the paratrooper will
// show, and they will be colors of red, green, black and white, to match the colors of the dubai
// flag."
//
// Built as a BufferGeometry rather than a trimmed CylinderGeometry. three.js can produce an open
// cylinder segment, but its arc starts from an axis that then has to be rotated into place, and
// getting that wrong gives a canopy lying on its side or facing backwards — a whole class of bug
// avoided by writing the twelve lines that place the vertices exactly where they belong. The curve
// sits directly OVERHEAD by construction, which is the one thing that has to be true.
//
// A DOME, NOT A STRIP. The first version read the "45 degrees" as a slice of a cylinder, which is an
// arc across and a straight line along — flat from half the angles you see it from, and shaded with
// one light value because every normal on it points the same way. The same two numbers read as a
// spherical CAP give a canopy curved both ways, which is both what a parachute is and what shades.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { currentGarrison } from './sites';
import {
  getCanopies, canopyCount, PARA_COUNT, CHUTE_COLOURS,
  CHUTE_RIM_M, CHUTE_HALF_ANGLE, CHUTE_SPHERE_R, CHUTE_LIFT_M,
} from './kaijuParatroopers';

/**
 * A spherical cap: a dome, curved in BOTH directions, with its apex directly over the jumper.
 *
 * The first version was a slice of a cylinder, which is curved across and dead straight along — and
 * looked it. Geoff: "The parachutes are single color and flat. They should be arcs but with a
 * width." A cap built from the same two numbers is 8 m across, 45 degrees of arc, and reads as a
 * canopy from any angle.
 *
 * Normals are radial and point DOWN AND OUT from the sphere's centre, which is the face anybody
 * underneath sees. That is also the fix for "single color": a flat sheet whose normals all point the
 * same way takes one light value across the whole thing, while a dome's normals fan out and it
 * shades from apex to rim on its own.
 */
function canopyGeometry(rings = 6, segments = 20): THREE.BufferGeometry {
  const R = CHUTE_SPHERE_R / METRES_PER_UNIT;
  // The cap hangs so its RIM is at the riser height, with the apex above that.
  const rimY = CHUTE_LIFT_M / METRES_PER_UNIT;
  const centreY = rimY + R * Math.cos(CHUTE_HALF_ANGLE);

  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    // Polar angle from straight DOWN at the sphere's centre, out to the cap's half angle.
    const phi = (r / rings) * CHUTE_HALF_ANGLE;
    const sinP = Math.sin(phi), cosP = Math.cos(phi);
    for (let s = 0; s <= segments; s++) {
      const th = (s / segments) * Math.PI * 2;
      const nx = sinP * Math.cos(th), ny = -cosP, nz = sinP * Math.sin(th);
      pos.push(nx * R, centreY + ny * R, nz * R);
      nrm.push(nx, ny, nz);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

export function KaijuParachutes() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => canopyGeometry(), []);
  useEffect(() => () => geo.dispose(), [geo]);

  const scratch = useMemo(() => ({
    m: new THREE.Matrix4(),
    side: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    up: new THREE.Vector3(),
    colour: new THREE.Color(),
  }), []);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const list = getCanopies();
    const n = Math.min(canopyCount(), PARA_COUNT);

    for (let i = 0; i < n; i++) {
      const c = list[i];
      // The canopy hangs along the jumper's own up, leaning into his drive — which is what a canopy
      // under forward drive actually does, and the only reason it does not look like a parked awning.
      scratch.up.copy(c.up).normalize();
      scratch.fwd.copy(c.fwd).addScaledVector(scratch.up, -c.fwd.dot(scratch.up));
      if (scratch.fwd.lengthSq() < 1e-12) scratch.fwd.set(0, 0, 1);
      scratch.fwd.normalize();
      // Tilt the whole canopy 12 degrees forward about the across-axis.
      scratch.side.crossVectors(scratch.up, scratch.fwd).normalize();
      const lean = 0.21;
      scratch.up.addScaledVector(scratch.fwd, Math.tan(lean)).normalize();
      scratch.fwd.crossVectors(scratch.side, scratch.up).normalize();

      scratch.m.makeBasis(scratch.side, scratch.up, scratch.fwd);
      scratch.m.setPosition(c.pos);
      m.setMatrixAt(i, scratch.m);
      // THE CITY'S OWN FLAG. Geoff, for New York: "make their colors red, white and blue for the
      // flag." The index was chosen when the man jumped; the PALETTE is read now, from whichever
      // site you are at, so the same drop code gives Dubai red-green-white-black and Manhattan
      // red-white-blue.
      const palette = currentGarrison().colours;
      const rgb = palette[c.colour % palette.length] ?? CHUTE_COLOURS[0];
      scratch.colour.setRGB(rgb[0], rgb[1], rgb[2]);
      m.setColorAt(i, scratch.colour);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    // Never culled: the bounding sphere is computed from one canopy at the origin, and left on the
    // whole stick vanishes the moment the world origin leaves the frustum — which on a planet is
    // always.
    <instancedMesh ref={mesh} args={[geo, undefined, PARA_COUNT]} frustumCulled={false}>
      {/* DoubleSide: it is a sheet with no thickness, and it is looked at from below far more often
          than from above. */}
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.9} metalness={0} />
    </instancedMesh>
  );
}
