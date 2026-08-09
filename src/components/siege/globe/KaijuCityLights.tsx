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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { loadRoads, getRoads, ROAD_TRAFFIC, type Road } from './cityRoads';
import type { City } from './cityData';

/**
 * How many vehicles across the whole 5,921 km of road.
 *
 * Geoff: "The lights you did of the cars are good but we should have 10x more of them."
 *
 * Ten times, exactly as asked. It is affordable because a car costs a handful of arithmetic and
 * three floats a frame — no object, no allocation, no draw call of its own; all nine thousand are
 * points in one buffer. The earlier 900 were spread over 386 km of motorway only, which is why
 * they read as sparse: the same count over the full network would have been a rumour.
 */
const CARS = 9000;
/* Speeds are per road class now — see CLASS_SPEED below. */
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

/**
 * Speed by road class, in metres per second.
 *
 * A motorway at 90 km/h and a residential street at 25 km/h, which is what separates the streams on
 * Sheikh Zayed Road from the drifting specks in the side streets. One speed for everything is the
 * quickest way to make a road network look like a screensaver.
 */
const CLASS_SPEED = [25, 25, 18, 14, 11, 7, 7, 12, 12, 11];

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

  const [roads, setRoads] = useState<Road[] | null>(getRoads());
  useEffect(() => { void loadRoads().then(setRoads); }, []);

  /**
   * Distribute vehicles over the network by LENGTH x CLASS.
   *
   * Length alone would be wrong now that residential streets are in the data: they make up most of
   * the 5,921 km, so a purely length-weighted draw would put the bulk of the traffic in cul-de-sacs
   * and leave the motorways looking abandoned. Weighting by class as well puts the streams where
   * the streams actually are.
   *
   * The cumulative table is built once and binary-searched, rather than the old linear walk — at
   * 15,571 roads and 9,000 cars that walk would have been 70 million comparisons on load.
   */
  const traffic = useMemo(() => {
    if (!roads || !roads.length) return [] as Car[];
    const weight = new Float64Array(roads.length);
    let grand = 0;
    for (let i = 0; i < roads.length; i++) {
      grand += roads[i].length * (ROAD_TRAFFIC[roads[i].cls] ?? 0.1);
      weight[i] = grand;
    }
    if (grand <= 0) return [] as Car[];

    const out: Car[] = [];
    for (let i = 0; i < CARS; i++) {
      const pick = Math.random() * grand;
      let lo = 0, hi = roads.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (weight[mid] < pick) lo = mid + 1; else hi = mid; }
      const r = roads[lo];
      if (r.length < 1) continue;
      const base = CLASS_SPEED[r.cls] ?? 12;
      out.push({
        road: r.pts, cum: r.cum,
        dist: Math.random() * r.length,
        // Spread of about a third, so a stream has cars closing on each other and pulling apart
        // instead of moving as one rigid comb — which is what makes it look like traffic.
        speed: base * (0.78 + Math.random() * 0.5),
        dir: Math.random() < 0.5 ? 1 : -1,
        seg: 0,
      });
    }
    return out;
  }, [roads]);

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
