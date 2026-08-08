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
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import {
  getBullets, getSparks, stepGunfire, MUZZLE_LIFE, SPARK_LIFE,
} from './kaijuGunfire';

/** Same ceilings as the pools, so a full pool can always be drawn. */
const MAX_TRAILS = 512;
const MAX_POINTS = 512;

/**
 * How many separate dashes a single round's streak is broken into.
 *
 * Geoff: "the bullet lines... are too heavy and don't look realistic. Can you make them more
 * stuttered and also varying from 10-40% opacity?"
 *
 * A tracer is not a solid rod of light — it is a fast-moving point smeared by the eye and by the
 * shutter, which comes out broken. So each streak is drawn as three short dashes with gaps between
 * them, and the gaps MOVE along the streak from frame to frame, which is what reads as stutter
 * rather than as a dotted line.
 */
const DASHES = 3;
/** Fraction of each dash slot that is actually drawn. The rest is gap. */
const DASH_DUTY = 0.55;

/**
 * How wide a tracer streak is, in metres.
 *
 * THIS is why the trails were invisible, and no amount of opacity would have fixed it. They were
 * drawn with GL lines, and WebGL renders every line exactly one pixel wide however wide you ask for
 * — so at 500 m a tracer was a single faint pixel. They are now camera-facing quads with a real
 * width in the world, which is the only way to have any control over this at all.
 */
const TRACER_WIDTH_M = 3;
const WIDTH_UNITS = TRACER_WIDTH_M / METRES_PER_UNIT;

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
  const tracers = useRef<THREE.InstancedMesh>(null);
  const camera = useThree((st) => st.camera);
  const muzzles = useRef<THREE.Points>(null);
  const sparks = useRef<THREE.Points>(null);

  const star = useMemo(() => starSprite(), []);
  useEffect(() => () => star.dispose(), [star]);

  // One allocation each, for the life of the component.
  const buf = useMemo(() => ({
    muzzlePos: new Float32Array(MAX_POINTS * 3),
    muzzleCol: new Float32Array(MAX_POINTS * 3),
    sparkPos: new Float32Array(MAX_POINTS * 3),
    sparkCol: new Float32Array(MAX_POINTS * 3),
  }), []);

  const _v = useMemo(() => new THREE.Vector3(), []);
  // Scratch for building each streak's transform. One set, reused for every quad every frame.
  const q = useMemo(() => ({
    a: new THREE.Vector3(), b: new THREE.Vector3(), mid: new THREE.Vector3(),
    dir: new THREE.Vector3(), toCam: new THREE.Vector3(),
    side: new THREE.Vector3(), nrm: new THREE.Vector3(),
    m: new THREE.Matrix4(), colour: new THREE.Color(),
  }), []);
  const clock = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    stepGunfire(dt);
    clock.current += dt;
    const T = tracers.current, M = muzzles.current, S = sparks.current;
    if (!T || !M || !S) return;

    const maxT = MAX_TRAILS * DASHES;
    let nT = 0, nM = 0, nS = 0;

    for (const b of getBullets()) {
      if (!b.live) continue;

      // MUZZLE FLASH. Brief and very bright: the pop of ignition, not a lamp.
      if (!b.ricocheted && b.age < MUZZLE_LIFE && nM < MAX_POINTS) {
        const f = 1 - b.age / MUZZLE_LIFE;
        const o = nM * 3;
        buf.muzzlePos[o] = b.origin.x; buf.muzzlePos[o + 1] = b.origin.y; buf.muzzlePos[o + 2] = b.origin.z;
        buf.muzzleCol[o] = f; buf.muzzleCol[o + 1] = f * 0.97; buf.muzzleCol[o + 2] = f * 0.78;
        nM++;
      }

      if (!b.tracer) continue;

      // THE STREAK, BROKEN INTO DASHES. The gaps slide along it over time, so a round in flight
      // shimmers instead of being a clean stripe. Every round has its own random phase, or the
      // whole volley would blink in unison and read as a strobe.
      const slide = (clock.current * 9 + b.flicker) % 1;
      for (let d = 0; d < DASHES && nT < maxT; d++) {
        let t0 = ((d + slide) / DASHES) % 1;
        let t1 = Math.min(1, t0 + DASH_DUTY / DASHES);
        if (t1 - t0 < 1e-3) continue;

        q.a.copy(b.tail).lerp(b.pos, t0);
        q.b.copy(b.tail).lerp(b.pos, t1);
        q.dir.copy(q.b).sub(q.a);
        const len = q.dir.length();
        if (len < 1e-6) continue;
        q.dir.divideScalar(len);
        q.mid.copy(q.a).lerp(q.b, 0.5);

        // Turn the quad edge-on to the viewer, so a streak is the same width whichever way it is
        // travelling and never flattens to nothing when it comes toward the camera.
        q.toCam.copy(camera.position).sub(q.mid).normalize();
        q.side.crossVectors(q.dir, q.toCam);
        if (q.side.lengthSq() < 1e-12) q.side.set(1, 0, 0); else q.side.normalize();
        q.nrm.crossVectors(q.side, q.dir);
        q.side.multiplyScalar(WIDTH_UNITS);
        q.dir.multiplyScalar(len);
        q.m.makeBasis(q.side, q.dir, q.nrm);
        q.m.setPosition(q.mid);
        T.setMatrixAt(nT, q.m);

        // A little per-dash jitter in brightness. Nothing about real gunfire is even. Brighter at
        // the leading end; ricochets run hotter orange because they are tumbling fragments.
        const jitter = 0.6 + 0.4 * Math.abs(Math.sin((clock.current * 30 + b.flicker + d) * 3.7));
        const a = b.alpha * jitter * (0.35 + 0.65 * t1);
        const warm = b.ricocheted ? 0.42 : 0.72;
        q.colour.setRGB(a, a * 0.85, a * warm);
        T.setColorAt(nT, q.colour);
        nT++;
      }
    }

    for (const sp of getSparks()) {
      if (!sp.live || nS >= MAX_POINTS) continue;
      const f = 1 - sp.age / SPARK_LIFE;
      const o = nS * 3;
      buf.sparkPos[o] = sp.pos.x; buf.sparkPos[o + 1] = sp.pos.y; buf.sparkPos[o + 2] = sp.pos.z;
      // Cools white -> orange as it dies, like a real strike on armour.
      buf.sparkCol[o] = f; buf.sparkCol[o + 1] = f * (0.45 + 0.5 * f); buf.sparkCol[o + 2] = f * f * 0.55;
      nS++;
    }

    T.count = nT;
    T.instanceMatrix.needsUpdate = true;
    if (T.instanceColor) T.instanceColor.needsUpdate = true;
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
      <instancedMesh ref={tracers} args={[undefined, undefined, MAX_TRAILS * DASHES]} frustumCulled={false}>
        {/* A unit plane. The instance matrix stretches it along the streak and turns it edge-on to
            the camera, so ONE geometry draws every tracer in the scene. */}
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          transparent
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>

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
