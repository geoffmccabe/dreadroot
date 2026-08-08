// KaijuGunfireFx — what the shooting LOOKS like: muzzle flashes, tracers, and sparks on the hide.
//
// Three draw calls for the whole army. Everything is one buffer per effect, rewritten in place each
// frame, because the alternative — an object per bullet — is two hundred mounts and unmounts a
// second and would cost more than the crowd it belongs to.
//
// THE STAR IS DRAWN, NOT LOADED.
//
// Geoff: "you can possibly just draw something like an SVG that's a star with a variety of points?
// Very bright yellow/white... very small so they would usually just be seen as little white dots
// from the scale we're at. If users zoomed in very close then they would see more of a star shape.
// Or I could give you a specific small webp with transparent bkgd."
//
// Exactly the right shape, and it does not need a file. The sprite is painted once into a canvas at
// startup: a hot white core, a yellow bloom, and spikes. That buys three things a webp cannot.
// There is no asset to ship, host, cache-bust or 404 — and a missing texture in this scene is an
// invisible effect with no error anywhere. It is generated at whatever resolution is wanted, so it
// stays crisp when somebody zooms in on a single rifleman. And the point count, spike length and
// colour are numbers here rather than baked pixels, so making the flash bigger or spikier is a one
// line change instead of a round trip through an image editor.
//
// If a hand-drawn flash is wanted later, `starSprite` is the only thing to replace: hand it a
// THREE.TextureLoader().load('/siege/fx/muzzle.webp') and nothing else in this file changes.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import {
  getShots, stepGunfire, TRACER_LIFE, MUZZLE_LIFE, SPARK_LIFE,
} from './kaijuGunfire';

/** Same ceiling as the shot pool, so a full pool can always be drawn. */
const MAX = 256;

/** A muzzle flash, in metres. Roughly a rifle's own flash — read as a dot at any real distance. */
const MUZZLE_M = 1.6;
/** A bullet strike on a 300 m creature. Small enough to stay a spark, big enough to catch the eye. */
const SPARK_M = 5;

/**
 * A star, painted into a canvas: hot white core, yellow bloom, and spikes of alternating length.
 *
 * The uneven spikes are the detail that matters. A perfectly regular star reads as a snowflake or a
 * sheriff's badge; real muzzle flashes are ragged, and varying every other point by a third is
 * enough to read as fire rather than as a symbol.
 */
function starSprite(points = 7, size = 128): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const c = size / 2;

  // The bloom first, so the spikes sit on top of it rather than being washed out by it.
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.12, 'rgba(255,252,214,0.95)');
  glow.addColorStop(0.32, 'rgba(255,214,96,0.42)');
  glow.addColorStop(1, 'rgba(255,170,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Spikes, as one filled star path reaching almost to the edge.
  ctx.beginPath();
  const outerA = c * 0.96, outerB = c * 0.62, inner = c * 0.16;
  for (let i = 0; i < points * 2; i++) {
    const long = i % 2 === 0;
    const r = long ? (i % 4 === 0 ? outerA : outerB) : inner;
    const ang = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = c + Math.cos(ang) * r;
    const y = c + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const spike = ctx.createRadialGradient(c, c, 0, c, c, c);
  spike.addColorStop(0, 'rgba(255,255,255,1)');
  spike.addColorStop(0.45, 'rgba(255,246,190,0.8)');
  spike.addColorStop(1, 'rgba(255,196,70,0)');
  ctx.fillStyle = spike;
  ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function KaijuGunfireFx() {
  const tracers = useRef<THREE.LineSegments>(null);
  const muzzles = useRef<THREE.Points>(null);
  const sparks = useRef<THREE.Points>(null);

  const star = useMemo(() => starSprite(), []);
  useEffect(() => () => star.dispose(), [star]);

  // One allocation each, for the life of the component.
  const buf = useMemo(() => ({
    tracerPos: new Float32Array(MAX * 2 * 3),
    tracerCol: new Float32Array(MAX * 2 * 3),
    muzzlePos: new Float32Array(MAX * 3),
    muzzleCol: new Float32Array(MAX * 3),
    sparkPos: new Float32Array(MAX * 3),
    sparkCol: new Float32Array(MAX * 3),
  }), []);

  const _v = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    stepGunfire(Math.min(rawDt, 0.05));
    const T = tracers.current, M = muzzles.current, S = sparks.current;
    if (!T || !M || !S) return;

    let nT = 0, nM = 0, nS = 0;
    for (const s of getShots()) {
      if (!s.live) continue;

      // TRACER. A hot line for a tenth of a second. WebGL draws every line one pixel wide whatever
      // linewidth says, which here is not a limitation but exactly the brief: "very thin, almost
      // invisible lines". Brightness carries the fade instead of thickness.
      if (s.age < TRACER_LIFE && nT < MAX) {
        const f = 1 - s.age / TRACER_LIFE;
        const o = nT * 6;
        buf.tracerPos[o] = s.from.x; buf.tracerPos[o + 1] = s.from.y; buf.tracerPos[o + 2] = s.from.z;
        buf.tracerPos[o + 3] = s.to.x; buf.tracerPos[o + 4] = s.to.y; buf.tracerPos[o + 5] = s.to.z;
        // Dim at the muzzle, bright at the leading end — which is the way a tracer actually reads,
        // and the cheapest possible way to show which direction it is travelling.
        buf.tracerCol[o] = 0.55 * f; buf.tracerCol[o + 1] = 0.42 * f; buf.tracerCol[o + 2] = 0.16 * f;
        buf.tracerCol[o + 3] = 1.0 * f; buf.tracerCol[o + 4] = 0.86 * f; buf.tracerCol[o + 5] = 0.5 * f;
        nT++;
      }

      // MUZZLE FLASH. Brief and very bright: it is the pop of ignition, not a lamp.
      if (s.age < MUZZLE_LIFE && nM < MAX) {
        const f = 1 - s.age / MUZZLE_LIFE;
        const o = nM * 3;
        buf.muzzlePos[o] = s.from.x; buf.muzzlePos[o + 1] = s.from.y; buf.muzzlePos[o + 2] = s.from.z;
        buf.muzzleCol[o] = f; buf.muzzleCol[o + 1] = f * 0.97; buf.muzzleCol[o + 2] = f * 0.78;
        nM++;
      }

      // IMPACT. Only where a capsule was genuinely crossed — `part`, not `hit`, because the impact
      // vector is pooled and a miss leaves the previous shot's value sitting in it.
      if (s.part && s.age < SPARK_LIFE && nS < MAX) {
        const f = 1 - s.age / SPARK_LIFE;
        // Nudge toward the shooter. The capsule is an approximation of a limb, so a point exactly on
        // its surface can sit a metre inside the skin it is meant to be on — and a spark occluded by
        // the creature it just hit is a spark nobody sees.
        _v.copy(s.hit).lerp(s.from, 0.02);
        const o = nS * 3;
        buf.sparkPos[o] = _v.x; buf.sparkPos[o + 1] = _v.y; buf.sparkPos[o + 2] = _v.z;
        // Cools white -> orange as it dies, like a real strike on armour.
        buf.sparkCol[o] = f; buf.sparkCol[o + 1] = f * (0.45 + 0.5 * f); buf.sparkCol[o + 2] = f * f * 0.55;
        nS++;
      }
    }

    T.geometry.setDrawRange(0, nT * 2);
    T.geometry.attributes.position.needsUpdate = true;
    T.geometry.attributes.color.needsUpdate = true;
    M.geometry.setDrawRange(0, nM);
    M.geometry.attributes.position.needsUpdate = true;
    M.geometry.attributes.color.needsUpdate = true;
    S.geometry.setDrawRange(0, nS);
    S.geometry.attributes.position.needsUpdate = true;
    S.geometry.attributes.color.needsUpdate = true;
  });

  return (
    <>
      {/* frustumCulled off on all three: the bounding sphere is computed once from an empty buffer,
          so left on, the whole effect vanishes the moment the camera is not looking at the origin. */}
      <lineSegments ref={tracers} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[buf.tracerPos, 3]} usage={THREE.DynamicDrawUsage} />
          <bufferAttribute attach="attributes-color" args={[buf.tracerCol, 3]} usage={THREE.DynamicDrawUsage} />
        </bufferGeometry>
        <lineBasicMaterial
          vertexColors
          transparent
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <points ref={muzzles} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[buf.muzzlePos, 3]} usage={THREE.DynamicDrawUsage} />
          <bufferAttribute attach="attributes-color" args={[buf.muzzleCol, 3]} usage={THREE.DynamicDrawUsage} />
        </bufferGeometry>
        <pointsMaterial
          map={star}
          size={MUZZLE_M / METRES_PER_UNIT}
          sizeAttenuation
          vertexColors
          transparent
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <points ref={sparks} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[buf.sparkPos, 3]} usage={THREE.DynamicDrawUsage} />
          <bufferAttribute attach="attributes-color" args={[buf.sparkCol, 3]} usage={THREE.DynamicDrawUsage} />
        </bufferGeometry>
        <pointsMaterial
          map={star}
          size={SPARK_M / METRES_PER_UNIT}
          sizeAttenuation
          vertexColors
          transparent
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}
