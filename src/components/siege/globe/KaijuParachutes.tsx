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
// WHAT IT LOOKS LIKE, honestly: 45 degrees of an 8 m circle is a strip 3.1 m across and 8 m long, so
// this reads as a curved sheet rather than a dome. That is what was asked for. CHUTE_ARC_RAD is the
// one number that widens it.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import {
  getCanopies, canopyCount, PARA_COUNT, CHUTE_COLOURS,
  CHUTE_RADIUS_M, CHUTE_ARC_RAD, CHUTE_LENGTH_M,
} from './kaijuParatroopers';

/**
 * A curved sheet: an arc of `segments` running across, extruded along its own axis.
 *
 * Local +Y is up, so the arc's apex sits directly over the origin — which is where the jumper is.
 * Local +Z runs along the canopy, which the renderer aligns with his direction of drive.
 */
function canopyGeometry(segments = 14): THREE.BufferGeometry {
  const r = CHUTE_RADIUS_M / METRES_PER_UNIT;
  const halfLen = CHUTE_LENGTH_M * 0.5 / METRES_PER_UNIT;
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];

  for (let i = 0; i <= segments; i++) {
    // Centred on straight up, so half the arc falls either side of the jumper's head.
    const a = -CHUTE_ARC_RAD * 0.5 + (i / segments) * CHUTE_ARC_RAD;
    const x = Math.sin(a) * r;
    const y = Math.cos(a) * r;
    // Normal points DOWN and outward — the underside is the face anyone below can see, and this is
    // a single-sided sheet drawn double-sided, so the lighting wants the side facing the ground.
    const nx = -Math.sin(a), ny = -Math.cos(a);
    pos.push(x, y, -halfLen, x, y, halfLen);
    nrm.push(nx, ny, 0, nx, ny, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a0 = i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
    idx.push(a0, b0, a1, a1, b0, b1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
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
      const rgb = CHUTE_COLOURS[c.colour % CHUTE_COLOURS.length];
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
