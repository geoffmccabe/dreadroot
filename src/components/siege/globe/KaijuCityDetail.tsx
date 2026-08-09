// KaijuCityDetail — the buildings that are not boxes.
//
// Geoff: "I think the Burj is just a rectangle that has its top cropped off, and all other buildings
// that have a spire or a dome or anything other than a rectangle are also wrong."
//
// It was cropped, by 306 m. The OSM outline the box bake read has no height tag at all — only
// `building:levels=163`, which came out as 522 m. The real building lives in OSM's Simple 3D
// Buildings layer as 38 nested `building:part` polygons rising to 828 m, which is the telescoping
// setback tower with a spire that it actually is. See scripts/make-city-detail.mjs.
//
// 1,214 solids across Dubai, each an extruded REAL polygon — not a bounding box, because the Burj's
// plan is a three-lobed Y and a rectangle would lose the one thing that identifies it from below.
// The 346 boxes these replace have been removed from the box bake, so nothing stands inside anything.
//
// ONE MESH, BUILT ONCE, about 60,000 triangles. That is less than a single Kaiju, and it buys every
// spire, dome, setback and podium in the city.
//
// THE PARTS ARE NESTED SOLIDS, and that is why they are all drawn from their own base rather than
// stacked. Most of the Burj's 38 parts start at ground level and stop at different heights, each
// with a smaller plan than the last; drawn as full solids they hide one another and the visible
// silhouette is the telescoping tower. Trying to be clever and stack them would produce floating
// rings.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { applyDetailWindows } from './cityWindows';

const ROOF_FLAT = 0, ROOF_PYRAMID = 1, ROOF_DOME = 2;
/** Rings used to loft a dome. Four is enough for a mosque dome at this distance and is 8x the tris. */
const DOME_RINGS = 4;

interface Solid {
  shape: number;
  minH: number; h: number; roofH: number;
  cx: number; cz: number;
  /** Flat [x,z,...] in metres from the city origin. */
  ring: Float32Array;
}

function parse(buf: ArrayBuffer): Solid[] {
  const dv = new DataView(buf);
  let o = 0;
  const n = dv.getUint32(o, true); o += 4;
  const out: Solid[] = [];
  for (let i = 0; i < n; i++) {
    const shape = dv.getUint8(o); o += 1;
    const count = dv.getUint16(o, true); o += 2;
    const minH = dv.getInt16(o, true); o += 2;
    const h = dv.getInt16(o, true); o += 2;
    const roofH = dv.getInt16(o, true); o += 2;
    const cx = dv.getInt16(o, true); o += 2;
    const cz = dv.getInt16(o, true); o += 2;
    const ring = new Float32Array(count * 2);
    for (let k = 0; k < count; k++) {
      // Decimetres relative to the centroid — see the bake.
      ring[k * 2] = cx + dv.getInt16(o, true) / 10; o += 2;
      ring[k * 2 + 1] = cz + dv.getInt16(o, true) / 10; o += 2;
    }
    out.push({ shape, minH, h, roofH, cx, cz, ring });
  }
  return out;
}

export function KaijuCityDetail() {
  const [solids, setSolids] = useState<Solid[] | null>(null);
  const timeRef = useRef({ value: 0 });

  useEffect(() => {
    let alive = true;
    fetch('/siege/city/dubai-detail.bin')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const s = parse(await res.arrayBuffer());
        if (!alive) return;
        const tallest = s.reduce((a, b) => (b.h > a ? b.h : a), 0);
        console.log(`[city] ${s.length.toLocaleString()} detailed solids, tallest ${tallest} m`);
        setSolids(s);
      })
      // Scenery: without it the described buildings are simply absent, which is worse than boxes but
      // far better than a broken scene.
      .catch((err) => console.error('[city] detail failed to load', err));
    return () => { alive = false; };
  }, []);

  const geometry = useMemo(() => {
    if (!solids || !solids.length) return null;
    const U = 1 / METRES_PER_UNIT;

    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const wu: number[] = [];      // metres along the wall, or -1 for a roof
    const wy: number[] = [];      // metres above sea level
    const sd: number[] = [];      // per-solid seed

    const colour = new THREE.Color();
    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpN = new THREE.Vector3();

    /** One triangle, with a face normal worked out from its own corners. */
    function tri(
      ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      cx2: number, cy: number, cz2: number,
      uA: number, uB: number, uC: number,
      r: number, g: number, b: number, seed: number,
    ) {
      tmpA.set(bx - ax, by - ay, bz - az);
      tmpB.set(cx2 - ax, cy - ay, cz2 - az);
      tmpN.crossVectors(tmpA, tmpB).normalize();
      const ys = [ay, by, cy];
      const us = [uA, uB, uC];
      const xs = [ax, bx, cx2], zs = [az, bz, cz2];
      for (let k = 0; k < 3; k++) {
        pos.push(xs[k], ys[k], zs[k]);
        nrm.push(tmpN.x, tmpN.y, tmpN.z);
        col.push(r, g, b);
        wu.push(us[k]);
        // Back to metres for the shader: the floor grid is in real metres, not render units.
        wy.push(ys[k] * METRES_PER_UNIT);
        sd.push(seed);
      }
    }

    for (let si = 0; si < solids.length; si++) {
      const s = solids[si];
      const n = s.ring.length / 2;
      if (n < 3) continue;
      const seed = ((si * 2654435761) % 1024) / 1024;

      // Same palette rule as the boxes, so a detailed tower does not stand out as a different city.
      const t = ((s.cx * 7919 + s.cz * 104729) % 1000 + 1000) % 1000 / 1000;
      const tall = Math.min(1, s.h / 200);
      colour.setHSL(0.08 + 0.5 * tall * (0.4 + 0.6 * t), 0.05 + 0.10 * t, 0.42 + 0.22 * t);
      const cr = colour.r, cg = colour.g, cb = colour.b;

      const y0 = s.minH * U, y1 = s.h * U;

      // --- walls -------------------------------------------------------------------------------
      let along = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = s.ring[i * 2] * U, az = s.ring[i * 2 + 1] * U;
        const bx = s.ring[j * 2] * U, bz = s.ring[j * 2 + 1] * U;
        const segM = Math.hypot(bx - ax, bz - az) * METRES_PER_UNIT;
        const u0 = along, u1 = along + segM;
        along = u1;
        if (segM < 0.05) continue;
        tri(ax, y0, az, bx, y0, bz, bx, y1, bz, u0, u1, u1, cr, cg, cb, seed);
        tri(ax, y0, az, bx, y1, bz, ax, y1, az, u0, u1, u0, cr, cg, cb, seed);
      }

      // --- roof --------------------------------------------------------------------------------
      const cxU = s.cx * U, czU = s.cz * U;
      // A little darker than the walls: a roof is concrete and plant, never glass.
      const rr = cr * 0.72, rg = cg * 0.72, rb = cb * 0.74;

      if (s.shape === ROOF_PYRAMID && s.roofH > 0) {
        const apex = (s.h + s.roofH) * U;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          tri(s.ring[i * 2] * U, y1, s.ring[i * 2 + 1] * U,
              s.ring[j * 2] * U, y1, s.ring[j * 2 + 1] * U,
              cxU, apex, czU, -1, -1, -1, rr, rg, rb, seed);
        }
      } else if (s.shape === ROOF_DOME && s.roofH > 0) {
        // Lofted rings: the plan shrinks by cos while the height climbs by sin, which is a hemisphere
        // stretched to whatever roof height the data gives. Cheap, and correct in silhouette, which
        // is all a dome is from a kilometre away.
        // Starts at ONE: the first ring is the footprint itself, at full size. Starting at zero
        // would collapse the dome's base to a point and hang it off the centroid.
        let prevK = 1, prevY = y1;
        for (let ring = 1; ring <= DOME_RINGS; ring++) {
          const a = (ring / DOME_RINGS) * (Math.PI / 2);
          const k = Math.cos(a);
          const yr = (s.h + s.roofH * Math.sin(a)) * U;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const pax = cxU + (s.ring[i * 2] * U - cxU) * prevK, paz = czU + (s.ring[i * 2 + 1] * U - czU) * prevK;
            const pbx = cxU + (s.ring[j * 2] * U - cxU) * prevK, pbz = czU + (s.ring[j * 2 + 1] * U - czU) * prevK;
            const nax = cxU + (s.ring[i * 2] * U - cxU) * k, naz = czU + (s.ring[i * 2 + 1] * U - czU) * k;
            const nbx = cxU + (s.ring[j * 2] * U - cxU) * k, nbz = czU + (s.ring[j * 2 + 1] * U - czU) * k;
            tri(pax, prevY, paz, pbx, prevY, pbz, nbx, yr, nbz, -1, -1, -1, rr, rg, rb, seed);
            tri(pax, prevY, paz, nbx, yr, nbz, nax, yr, naz, -1, -1, -1, rr, rg, rb, seed);
          }
          prevK = k; prevY = yr;
        }
      } else {
        // Flat: a fan from the centroid. Building footprints are star-shaped about their centroid
        // often enough that this is right, and where it is not the error is a sliver of roof on a
        // building seen from above at a kilometre.
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          tri(s.ring[i * 2] * U, y1, s.ring[i * 2 + 1] * U,
              s.ring[j * 2] * U, y1, s.ring[j * 2 + 1] * U,
              cxU, y1, czU, -1, -1, -1, rr, rg, rb, seed);
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setAttribute('aWallU', new THREE.BufferAttribute(new Float32Array(wu), 1));
    g.setAttribute('aWallY', new THREE.BufferAttribute(new Float32Array(wy), 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(sd), 1));
    g.computeBoundingSphere();
    console.log(`[city] ${(pos.length / 9).toLocaleString()} detail triangles`);
    return g;
  }, [solids]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Both faces. OSM ways are wound either way round and a building traced clockwise would
      // otherwise be inside-out — invisible from outside, which is the worst possible failure here.
      side: THREE.DoubleSide,
    });
    applyDetailWindows(m, timeRef.current);
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  // The window shader's clock. Its own, rather than shared with the box city, because the two
  // materials compile separately and a uniform object cannot be handed across a module boundary
  // without one of them silently getting a stale copy.
  useFrame((_, dt) => { timeRef.current.value += dt; });

  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} frustumCulled={false} castShadow receiveShadow />;
}
