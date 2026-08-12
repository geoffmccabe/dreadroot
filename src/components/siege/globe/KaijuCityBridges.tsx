// KaijuCityBridges — the spans, raised off the water.
//
// Geoff: "for NYC can you add their famous bridges?"
//
// They were worse than absent. A bridge is tagged in OSM as an ordinary highway carrying bridge=yes,
// so the road bake had already swallowed the Brooklyn, the Manhattan, the Williamsburg and the
// Queensboro and painted them FLAT ON THE RIVER at twenty centimetres — four of the most
// recognisable structures on Earth, drawn as puddles. This lifts them off it.
//
// A DECK, AND TOWERS WHERE TOWERS BELONG. The deck rises on a sine from its abutments to a crown at
// mid-span, which is the shape a bridge actually has and the reason ships fit under one. Long water
// crossings additionally get towers at the quarter points, which is where a suspension bridge puts
// them.
//
// NO CABLES, deliberately. At a hundred metres to the game unit a suspender cable is a hundredth of
// a pixel wide; drawing it would cost thousands of triangles to produce aliasing and nothing else.
// The silhouette that reads at this distance is deck plus towers.
//
// The heights come from the bake, which derives rather than reads them — see make-bridges for why,
// and for the one bridge that comes out short.

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { cityAssetPath } from './sites';

interface Bridge {
  towers: boolean;
  width: number;
  crown: number;
  /** Flat [x,z,...] in metres from the city origin. */
  pts: Float32Array;
}

function parse(buf: ArrayBuffer): Bridge[] {
  const dv = new DataView(buf);
  let o = 0;
  const n = dv.getUint32(o, true); o += 4;
  const out: Bridge[] = [];
  for (let i = 0; i < n; i++) {
    const towers = dv.getUint8(o) === 1; o += 1;
    const count = dv.getUint16(o, true); o += 2;
    const width = dv.getInt16(o, true); o += 2;
    const crown = dv.getInt16(o, true); o += 2;
    const pts = new Float32Array(count * 2);
    for (let k = 0; k < count; k++) {
      pts[k * 2] = dv.getInt16(o, true); o += 2;
      pts[k * 2 + 1] = dv.getInt16(o, true); o += 2;
    }
    out.push({ towers, width, crown, pts });
  }
  return out;
}

export function KaijuCityBridges({ slug, refGroundM }: { slug: string; refGroundM: number }) {
  const [bridges, setBridges] = useState<Bridge[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(cityAssetPath(slug, 'bridges.bin'))
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const b = parse(await res.arrayBuffer());
        if (!alive) return;
        console.log(`[city] ${b.length} bridges`);
        setBridges(b);
      })
      // Scenery, like every other city layer: it fails quietly rather than taking the frame loop.
      .catch((err) => console.error('[city] bridges failed to load', err));
    return () => { alive = false; };
  }, [slug]);

  const geometry = useMemo(() => {
    if (!bridges || !bridges.length) return null;
    const U = 1 / METRES_PER_UNIT;
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];

    const A = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3();
    const quad = (
      ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
      r: number, g: number, bl: number,
    ) => {
      for (const [p, q, s] of [[[ax, ay, az], [bx, by, bz], [cx, cy, cz]], [[ax, ay, az], [cx, cy, cz], [dx, dy, dz]]] as number[][][]) {
        A.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        B.set(s[0] - p[0], s[1] - p[1], s[2] - p[2]);
        N.crossVectors(A, B).normalize();
        for (const v of [p, q, s]) {
          pos.push(v[0], v[1], v[2]);
          nrm.push(N.x, N.y, N.z);
          col.push(r, g, bl);
        }
      }
    };

    for (const br of bridges) {
      const n = br.pts.length / 2;
      if (n < 2) continue;
      // Distance along, so the crown lands at the true middle rather than the middle POINT — a way
      // whose nodes bunch at one end would otherwise put the peak in the wrong place.
      const cum = new Float32Array(n);
      let total = 0;
      for (let i = 1; i < n; i++) {
        total += Math.hypot(br.pts[i * 2] - br.pts[(i - 1) * 2], br.pts[i * 2 + 1] - br.pts[(i - 1) * 2 + 1]);
        cum[i] = total;
      }
      if (total < 1) continue;
      // Sine, so the deck leaves the ground level at both abutments rather than kinking upward.
      const heightAt = (i: number) => br.crown * Math.sin(Math.PI * (cum[i] / total));

      const half = br.width * 0.5;
      // Pale concrete. Slightly warmer than the asphalt so a bridge reads as a structure rather
      // than as a road that happens to be in the air.
      const cr = 0.38, cg = 0.37, cb = 0.36;

      for (let i = 1; i < n; i++) {
        const axm = br.pts[(i - 1) * 2], azm = br.pts[(i - 1) * 2 + 1];
        const bxm = br.pts[i * 2], bzm = br.pts[i * 2 + 1];
        let dx = bxm - axm, dz = bzm - azm;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        dx /= len; dz /= len;
        const nx = -dz * half, nz = dx * half;
        const ya = (heightAt(i - 1) - refGroundM) * U;
        const yb = (heightAt(i) - refGroundM) * U;

        // The deck.
        quad(
          (axm - nx) * U, ya, (azm - nz) * U, (axm + nx) * U, ya, (azm + nz) * U,
          (bxm + nx) * U, yb, (bzm + nz) * U, (bxm - nx) * U, yb, (bzm - nz) * U,
          cr, cg, cb,
        );
        // A shallow girder under it, so the deck has thickness seen from below or from the side —
        // a bridge viewed edge-on with no depth reads as a floating line.
        const drop = 4 * U;
        for (const s of [-1, 1]) {
          quad(
            (axm + nx * s) * U, ya, (azm + nz * s) * U, (bxm + nx * s) * U, yb, (bzm + nz * s) * U,
            (bxm + nx * s) * U, yb - drop, (bzm + nz * s) * U, (axm + nx * s) * U, ya - drop, (azm + nz * s) * U,
            cr * 0.7, cg * 0.7, cb * 0.7,
          );
        }
      }

      // --- towers ---------------------------------------------------------------------------
      if (!br.towers) continue;
      for (const t of [0.25, 0.75]) {
        const target = total * t;
        let i = 1;
        while (i < n - 1 && cum[i] < target) i++;
        const x = br.pts[i * 2], z = br.pts[i * 2 + 1];
        const deck = heightAt(i);
        const top = deck + br.crown * 0.85;
        const w = Math.max(8, br.width * 0.45);
        const y0 = (0 - refGroundM) * U, y1 = (top - refGroundM) * U;
        // A plain rectangular pier. The Brooklyn Bridge's towers are gothic arches and this is not
        // that — but a vertical mass at the right place and the right height is what makes the
        // silhouette read as a suspension bridge from a kilometre away.
        for (const s of [-1, 1]) {
          const ox = s * (br.width * 0.35);
          const cx = x + ox, cz = z;
          const c = [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
          for (let k = 0; k < 4; k++) {
            const p = c[k], q = c[(k + 1) % 4];
            quad(
              (cx + p[0]) * U, y0, (cz + p[1]) * U, (cx + q[0]) * U, y0, (cz + q[1]) * U,
              (cx + q[0]) * U, y1, (cz + q[1]) * U, (cx + p[0]) * U, y1, (cz + p[1]) * U,
              0.34, 0.31, 0.29,
            );
          }
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.computeBoundingSphere();
    console.log(`[city] ${(pos.length / 9).toLocaleString()} bridge triangles`);
    return g;
  }, [bridges, refGroundM]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(() => new THREE.MeshLambertMaterial({
    vertexColors: true,
    // Both faces: a deck is seen from underneath as often as from above once you are 300 m tall.
    side: THREE.DoubleSide,
  }), []);
  useEffect(() => () => material.dispose(), [material]);

  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} frustumCulled={false} castShadow receiveShadow />;
}
