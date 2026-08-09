// KaijuCityLights — traffic on the real roads, and the red lamps on the tall roofs.
//
// Geoff: "if you do add blinking lights, they shouldn't be like christmas lights but very rarely
// adding them, although it could be good to have some lights moving along the streets like cars, at
// car speed, if you were able to create that sort of illusion it could be nice."
//
// TWO THINGS, and only one of them blinks.
//
// TRAFFIC. Points running along Dubai's actual motorways, trunk roads and primary roads — 301 of
// them, 386 km, imported once and baked to 4.9 KB. Real roads matter: traffic reads as traffic
// because it runs in continuous rivers along routes that exist, and Sheikh Zayed Road carrying a
// stream of light the length of the city is the most recognisable thing about the place at night.
// Scattered moving dots between buildings would read as fireflies.
//
// White going one way, red going the other, at 90 km/h — which at a hundred metres to the unit is
// slow and steady rather than the twitching a scaled-up speed would give.
//
// BEACONS. Aircraft warning lamps, red, on roofs above 180 m. These are the only thing that blinks,
// they are rare by construction — a few dozen buildings out of 59,202 are that tall — and each one
// has its own period and phase so they never pulse together. That is what a real skyline does.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { cityRoads } from './dubaiRoads';
import type { City } from './cityData';

/** How many vehicles across the whole 386 km of road. */
const CARS = 900;
/** 90 km/h. Real motorway speed; anything faster reads as a twitch at this scale. */
const CAR_SPEED_MS = 25;
/** Headlight/taillight size in metres. Small — a car is 2 m wide and 20 km of city is in frame. */
const CAR_SIZE_M = 6;
/** Only roofs above this get an aircraft warning lamp. */
const BEACON_MIN_HEIGHT_M = 180;
const BEACON_SIZE_M = 14;

interface Car {
  road: Float32Array;
  /** Cumulative length at each point, so a distance maps to a segment without searching. */
  cum: Float32Array;
  dist: number;
  speed: number;
  /** +1 drives along the polyline (white), -1 against it (red). */
  dir: 1 | -1;
  seg: number;
}

export function KaijuCityLights({ city }: { city: City }) {
  const cars = useRef<THREE.Points>(null);
  const beacons = useRef<THREE.Points>(null);
  const time = useRef(0);

  /** A soft round dot. Same trick as the muzzle flash: drawn once, no asset to ship. */
  const dot = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => dot.dispose(), [dot]);

  /** Distribute vehicles over the road network BY LENGTH, so long highways carry more traffic. */
  const traffic = useMemo(() => {
    const roads = cityRoads();
    if (!roads.length) return [] as Car[];
    const cums: Float32Array[] = [];
    const totals: number[] = [];
    let grand = 0;
    for (const r of roads) {
      const c = new Float32Array(r.length / 2);
      let s = 0;
      for (let i = 1; i < r.length / 2; i++) {
        s += Math.hypot(r[i * 2] - r[(i - 1) * 2], r[i * 2 + 1] - r[(i - 1) * 2 + 1]);
        c[i] = s;
      }
      cums.push(c);
      totals.push(s);
      grand += s;
    }
    const out: Car[] = [];
    for (let i = 0; i < CARS; i++) {
      // Pick a road weighted by its length — a 20 km motorway should get twenty times the cars of
      // a 1 km link, which is what makes the big roads look like the big roads.
      let pick = Math.random() * grand;
      let ri = 0;
      while (ri < totals.length - 1 && pick > totals[ri]) { pick -= totals[ri]; ri++; }
      const len = totals[ri];
      if (len < 1) continue;
      out.push({
        road: roads[ri], cum: cums[ri],
        dist: Math.random() * len,
        speed: CAR_SPEED_MS * (0.8 + Math.random() * 0.45),
        dir: Math.random() < 0.5 ? 1 : -1,
        seg: 0,
      });
    }
    return out;
  }, []);

  /** Every roof tall enough for a warning lamp, with its own blink period and phase. */
  const beaconData = useMemo(() => {
    const pos: number[] = [];
    const phase: number[] = [];
    const period: number[] = [];
    const U = 1 / METRES_PER_UNIT;
    for (const b of city.buildings) {
      if (b.h < BEACON_MIN_HEIGHT_M) continue;
      pos.push(b.x * U, (b.h + 6) * U, b.z * U);
      // Own period and phase, so a skyline of them never pulses in unison.
      phase.push(Math.random());
      period.push(1.6 + Math.random() * 1.6);
    }
    return {
      count: pos.length / 3,
      pos: new Float32Array(pos),
      colour: new Float32Array(pos.length),
      phase, period,
    };
  }, [city]);

  const carBuf = useMemo(() => ({
    pos: new Float32Array(Math.max(1, traffic.length) * 3),
    col: new Float32Array(Math.max(1, traffic.length) * 3),
  }), [traffic.length]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    time.current += dt;
    const U = 1 / METRES_PER_UNIT;

    // --- traffic ---------------------------------------------------------------------------------
    const C = cars.current;
    if (C && traffic.length) {
      for (let i = 0; i < traffic.length; i++) {
        const c = traffic[i];
        const n = c.cum.length;
        const total = c.cum[n - 1];
        c.dist += c.speed * c.dir * dt;
        // Wrap rather than turn round: a car that reverses at the end of a road is instantly a
        // cartoon, and at this distance nobody can tell one vehicle from the next anyway.
        if (c.dist > total) c.dist -= total;
        else if (c.dist < 0) c.dist += total;

        // Walk from the remembered segment instead of searching. A car crosses at most one segment
        // per frame, so this is a step or two rather than a binary search over the whole road.
        let s = Math.min(c.seg, n - 2);
        while (s > 0 && c.cum[s] > c.dist) s--;
        while (s < n - 2 && c.cum[s + 1] < c.dist) s++;
        c.seg = s;

        const segLen = Math.max(1e-3, c.cum[s + 1] - c.cum[s]);
        const t = Math.max(0, Math.min(1, (c.dist - c.cum[s]) / segLen));
        const x = c.road[s * 2] + (c.road[(s + 1) * 2] - c.road[s * 2]) * t;
        const z = c.road[s * 2 + 1] + (c.road[(s + 1) * 2 + 1] - c.road[s * 2 + 1]) * t;

        const o = i * 3;
        carBuf.pos[o] = x * U;
        carBuf.pos[o + 1] = 3 * U;              // three metres up: headlight height
        carBuf.pos[o + 2] = z * U;
        if (c.dir > 0) { carBuf.col[o] = 1.0; carBuf.col[o + 1] = 0.95; carBuf.col[o + 2] = 0.80; }
        else { carBuf.col[o] = 1.0; carBuf.col[o + 1] = 0.16; carBuf.col[o + 2] = 0.08; }
      }
      C.geometry.attributes.position.needsUpdate = true;
      C.geometry.attributes.color.needsUpdate = true;
    }

    // --- warning lamps ---------------------------------------------------------------------------
    const B = beacons.current;
    if (B && beaconData.count) {
      const col = beaconData.colour;
      for (let i = 0; i < beaconData.count; i++) {
        // A short flash and a long dark gap, which is what an aviation lamp actually does.
        const p = (time.current / beaconData.period[i] + beaconData.phase[i]) % 1;
        const on = p < 0.18 ? 1 : 0;
        const o = i * 3;
        col[o] = on; col[o + 1] = on * 0.05; col[o + 2] = on * 0.03;
      }
      B.geometry.attributes.color.needsUpdate = true;
    }
  });

  return (
    <>
      <points ref={cars} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[carBuf.pos, 3]} usage={THREE.DynamicDrawUsage} />
          <bufferAttribute attach="attributes-color" args={[carBuf.col, 3]} usage={THREE.DynamicDrawUsage} />
        </bufferGeometry>
        <pointsMaterial
          map={dot} size={CAR_SIZE_M / METRES_PER_UNIT} sizeAttenuation vertexColors
          transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending}
        />
      </points>

      <points ref={beacons} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[beaconData.pos, 3]} usage={THREE.StaticDrawUsage} />
          <bufferAttribute attach="attributes-color" args={[beaconData.colour, 3]} usage={THREE.DynamicDrawUsage} />
        </bufferGeometry>
        <pointsMaterial
          map={dot} size={BEACON_SIZE_M / METRES_PER_UNIT} sizeAttenuation vertexColors
          transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}
