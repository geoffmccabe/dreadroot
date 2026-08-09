// KaijuCity — Dubai, as forty thousand boxes in one draw call.
//
// PHASE 1 of docs/KAIJU_CITY_PLAN.md: the city exists, in the right place, at the right scale, with
// the right silhouette. No windows, no lights, no colliders, no destruction — those are phases 2, 3
// and 4, and doing them before the shapes are proven correct would mean debugging four things at
// once.
//
// EVERYTHING HANGS OFF ONE GROUP, and that is not tidiness, it is arithmetic. See the long note in
// cityData.ts: at 63,710 units from the world origin a float32 can only resolve about 0.4 m, so
// buildings placed in world coordinates would shimmer and z-fight against each other. Inside a group
// that already carries the big offset, every building is a few kilometres from ITS origin, where the
// same float has millimetre precision going spare.
//
// The instance matrices are written ONCE, at load. Buildings do not move — until one is knocked
// down, which is phase 4's problem and will rewrite only the rows that changed.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { loadCity, getCity, cityDistanceUnits, cityDiag, type City } from './cityData';

/**
 * Beyond this the city is not drawn at all.
 *
 * 400 units is 40 km — comfortably past the far side of every district, so the skyline is complete
 * from anywhere you would fight, and gone by the time you are in orbit. Forty thousand boxes is
 * cheap to draw and not free, and from space it is a smudge two pixels across.
 */
const DRAW_WITHIN_UNITS = 400;

export function KaijuCity() {
  const [city, setCity] = useState<City | null>(getCity());
  useEffect(() => { loadCity().then(setCity); }, []);
  if (!city) return null;
  return <CityMesh city={city} />;
}

function CityMesh({ city }: { city: City }) {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.InstancedMesh>(null);

  const count = city.buildings.length;

  // A unit cube whose ORIGIN IS ITS BASE, not its centre.
  //
  // Translating the geometry once here means every instance matrix is (position on the ground,
  // rotation, size) with no half-height correction — and, more usefully, phase 4 can shorten a
  // building by scaling Y alone and it will sink into its own footprint rather than into the
  // ground. Doing it per instance instead would be forty thousand extra additions and a
  // correction that has to be remembered at every future call site.
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => new THREE.MeshLambertMaterial({
    // Grey, and deliberately so for phase 1: a flat colour makes a wrong SHAPE obvious, where a
    // convincing facade would hide it. Windows arrive in phase 2, once the silhouette is trusted.
    color: 0x9aa3ad,
    // NOT `vertexColors`. An InstancedMesh's per-instance colours come from `instanceColor`, which
    // three enables on its own the moment setColorAt is called. `vertexColors` is a different
    // feature that expects a `color` attribute ON THE GEOMETRY — which a BoxGeometry does not have,
    // so the shader would read a missing attribute as zero and draw the entire city black.
  }), []);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    const U = 1 / METRES_PER_UNIT;

    for (let i = 0; i < count; i++) {
      const b = city.buildings[i];
      dummy.position.set(b.x * U, 0, b.z * U);
      // NEGATIVE rot. The bake stores the angle in a (east, south) plane, and a rotation about the
      // local +Y axis carries +X toward -Z — the opposite way round. Getting this wrong mirrors
      // every building's orientation, which on a grid city reads as "almost right" and is exactly
      // the sort of thing that survives a look.
      dummy.rotation.set(0, -b.rot, 0);
      dummy.scale.set(b.w * U, b.h * U, b.d * U);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);

      // A little variation so the city is not one flat plate of grey. Concrete, sand-stone and
      // glass-blue, chosen by a hash of the building's own size so it is stable across reloads.
      const t = ((b.x * 7919 + b.z * 104729) % 1000 + 1000) % 1000 / 1000;
      const tall = Math.min(1, b.h / 200);
      // Taller buildings skew glassier and cooler; low-rise skews sandy. Roughly true of Dubai.
      colour.setHSL(0.08 + 0.5 * tall * (0.4 + 0.6 * t), 0.05 + 0.10 * t, 0.42 + 0.22 * t);
      m.setColorAt(i, colour);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // Computed from the instances rather than the unit cube, or the whole city would vanish the
    // moment the group's own origin left the frustum.
    m.computeBoundingSphere();
    console.log(`[city] placed ${count.toLocaleString()} buildings`);
  }, [city, count]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.position.copy(city.position);
    g.quaternion.copy(city.quaternion);
  }, [city]);

  // Drawn only when you are near enough for it to be a city rather than a smudge.
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.visible = cityDistanceUnits(camera.position) < DRAW_WITHIN_UNITS;
  });

  return (
    <group ref={group}>
      <instancedMesh
        ref={mesh}
        args={[geometry, material, count]}
        frustumCulled={false}
      />
    </group>
  );
}
