// KaijuCityWater — the Marina's marina, the Burj Lake, the Creek, the Business Bay canal.
//
// Geoff: "The Marina area has no marina... they're just sand. Maybe you can do it as just a colour
// the way you did the roads?"
//
// Exactly that. The land mask already knew where this water was — the channels are punched out of
// it and the ground beneath them really does drop to sea floor — but knowing and DRAWING are
// different jobs, and two things kept it looking like sand:
//
//   THE MESH IS TOO COARSE. The terrain resolves 38 m at best, and the Marina's channel is about
//   120 m across. Three vertices cannot describe a trench with two walls; they describe a dip.
//
//   THE OCEAN IS ALMOST CLEAR AT THIS DEPTH. Its opacity ramps with depth and only approaches solid
//   at 120 m, so over a coastal channel it is a faint blue tint over a sand-coloured bed.
//
// So the waterways get their own surface: 369 real outlines, triangulated offline, laid flat at sea
// level as one mesh. Same approach as the roads, for the same reason — the shape is known exactly,
// it is flat, and it only needs to be opaque enough to read as water.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';

/**
 * Height of the water surface, in metres relative to the city group's origin.
 *
 * The group sits on the city's ground, half a metre above sea level, so -0.35 puts the water
 * 15 cm ABOVE true sea level and 35 cm BELOW the quayside. Both halves matter: above sea level so
 * it does not fight the planet's own ocean mesh for the same pixels, and below the land so the
 * water sits in its channel rather than on top of it.
 */
const WATER_Y_M = -0.35;

export function KaijuCityWater() {
  const [tris, setTris] = useState<Float32Array | null>(null);
  const mat = useRef<THREE.MeshLambertMaterial>(null);
  const time = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch('/siege/city/dubai-water.bin')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const dv = new DataView(buf);
        const n = dv.getUint32(0, true);
        const U = 1 / METRES_PER_UNIT;
        const y = WATER_Y_M * U;
        const pos = new Float32Array(n * 9);
        let o = 4, p = 0;
        for (let i = 0; i < n * 3; i++) {
          pos[p++] = dv.getInt16(o, true) * U; o += 2;
          pos[p++] = y;
          pos[p++] = dv.getInt16(o, true) * U; o += 2;
        }
        if (!alive) return;
        console.log(`[city] ${n.toLocaleString()} water triangles`);
        setTris(pos);
      })
      // Scenery, like the roads: a city with dry channels beats no city, so this never rejects into
      // the render tree.
      .catch((err) => console.error('[city] water failed to load', err));
    return () => { alive = false; };
  }, []);

  const geometry = useMemo(() => {
    if (!tris) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
    // Flat and upward everywhere — no reason to make the GPU derive that per vertex.
    const nrm = new Float32Array(tris.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    return g;
  }, [tris]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  // A slow breathing of the colour, so the surface is not a dead plate. Deliberately not a normal
  // map or a ripple: at 100 m to the unit, real wave detail is far below a pixel, and what actually
  // sells water at this distance is that its tone shifts while the sand around it does not.
  useFrame((_, dt) => {
    const m = mat.current;
    if (!m) return;
    time.current += dt;
    const t = 0.5 + 0.5 * Math.sin(time.current * 0.35);
    m.color.setRGB(0.05 + 0.03 * t, 0.34 + 0.06 * t, 0.44 + 0.08 * t);
  });

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={1}>
      <meshLambertMaterial
        ref={mat}
        color={0x0a5870}
        transparent
        opacity={0.82}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
