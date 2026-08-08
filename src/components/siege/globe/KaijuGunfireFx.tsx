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
  getBullets, getSparks, stepGunfire, MUZZLE_LIFE, SPARK_LIFE,
} from './kaijuGunfire';

/** Same ceilings as the pools, so a full pool can always be drawn. */
const MAX_TRAILS = 1024;
const MAX_POINTS = 768;

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
 * BACK TO GL LINES, WHICH ARE ALWAYS EXACTLY ONE PIXEL.
 *
 * Geoff: "they are still too wide so make them thinner... back to 1 pixel wide."
 *
 * The quads existed because WebGL ignores line width, so a line can never be made thicker — and when
 * the trails were 10-40% opaque and 80 m long they were invisible. Both of those have since been
 * fixed the other way (45-100% brightness, 160 m long), so the reason for the quads is gone. And
 * lines have a real advantage here beyond thinness: a line has no width dimension at all, so the
 * "wide rectangle" failure — a streak shorter than it is wide — cannot happen. A slow ricochet just
 * draws a short line.
 */

/** A muzzle flash, in metres. Roughly a rifle's own flash — read as a dot at any real distance. */
const MUZZLE_M = 1.6;
/**
 * A bullet strike on a 300 m creature. Small enough to stay a spark, big enough to catch the eye.
 *
 * 9 m, not 5. Geoff could see the ricochet but not the flash that caused it — mostly because the
 * rounds were bouncing off the wrong collider entirely (see BULLET_TORSO_FRAC), but 5 m on a
 * creature 300 m tall is also under 2% of its height, which is a speck.
 */
const SPARK_M = 9;
/** How far out from the hide the flash sits, so it is never swallowed by the mesh it landed on. */
const SPARK_LIFT_M = 4;
/** A round into the dirt. Smaller than a strike on the monster, because it matters less. */
const DIRT_M = 5;

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

/**
 * Teach PointsMaterial to read a per-point `size` attribute.
 *
 * three.js builds gl_PointSize from a single uniform. Rather than write a whole material to vary one
 * number, the stock shader is patched: declare the attribute and multiply it in. This is the
 * documented extension point and survives three.js upgrades far better than a hand-rolled copy of
 * the built-in shader would.
 */
function perPointSize(shader: { vertexShader: string }): void {
  // The attribute is `aSize`, NOT `size`: three.js already declares `uniform float size` in this
  // shader, and a second declaration under the same name is a compile error that shows up as a
  // silently blank material rather than as anything readable.
  shader.vertexShader = 'attribute float aSize;\n'
    + shader.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = aSize;');
}

export function KaijuGunfireFx() {
  const tracers = useRef<THREE.LineSegments>(null);
  const muzzles = useRef<THREE.Points>(null);
  const sparks = useRef<THREE.Points>(null);

  const star = useMemo(() => starSprite(), []);
  useEffect(() => () => star.dispose(), [star]);

  // One allocation each, for the life of the component.
  const buf = useMemo(() => ({
    tracerPos: new Float32Array(MAX_TRAILS * DASHES * 2 * 3),
    tracerCol: new Float32Array(MAX_TRAILS * DASHES * 2 * 3),
    muzzlePos: new Float32Array(MAX_POINTS * 3),
    muzzleCol: new Float32Array(MAX_POINTS * 3),
    sparkPos: new Float32Array(MAX_POINTS * 3),
    sparkCol: new Float32Array(MAX_POINTS * 3),
    sparkSize: new Float32Array(MAX_POINTS),
  }), []);

  const _v = useMemo(() => new THREE.Vector3(), []);
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
      for (let d = 0; d < DASHES && nT < MAX_TRAILS * DASHES; d++) {
        const t0 = ((d + slide) / DASHES) % 1;
        const t1 = Math.min(1, t0 + DASH_DUTY / DASHES);
        if (t1 - t0 < 1e-3) continue;

        const o = nT * 6;
        _v.copy(b.tail).lerp(b.pos, t0);
        buf.tracerPos[o] = _v.x; buf.tracerPos[o + 1] = _v.y; buf.tracerPos[o + 2] = _v.z;
        _v.copy(b.tail).lerp(b.pos, t1);
        buf.tracerPos[o + 3] = _v.x; buf.tracerPos[o + 4] = _v.y; buf.tracerPos[o + 5] = _v.z;

        // A little per-dash jitter in brightness. Nothing about real gunfire is even. Dim at the
        // back, bright at the leading end — the cheapest way to show which way it is travelling.
        // A ricochet runs hotter orange, being a tumbling fragment rather than a bullet.
        const jitter = 0.6 + 0.4 * Math.abs(Math.sin((clock.current * 30 + b.flicker + d) * 3.7));
        const a = b.alpha * jitter;
        const warm = b.ricocheted ? 0.42 : 0.72;
        const back = a * (0.3 + 0.7 * t0), front = a * (0.3 + 0.7 * t1);
        buf.tracerCol[o] = 0.95 * back; buf.tracerCol[o + 1] = 0.82 * back; buf.tracerCol[o + 2] = warm * back;
        buf.tracerCol[o + 3] = front; buf.tracerCol[o + 4] = 0.88 * front; buf.tracerCol[o + 5] = warm * front;
        nT++;
      }
    }

    for (const sp of getSparks()) {
      if (!sp.live || nS >= MAX_POINTS) continue;
      const f = 1 - sp.age / SPARK_LIFE;
      const o = nS * 3;
      // LIFT IT OFF THE SURFACE. The capsule is an approximation of a limb, so a point exactly on
      // its surface can sit a few metres inside the mesh it is supposed to be marking — and a flash
      // hidden inside the creature that stopped the bullet is a flash nobody ever sees.
      _v.copy(sp.pos).addScaledVector(sp.nrm, SPARK_LIFT_M / METRES_PER_UNIT);
      buf.sparkPos[o] = _v.x; buf.sparkPos[o + 1] = _v.y; buf.sparkPos[o + 2] = _v.z;
      if (sp.kind === 'dirt') {
        // Dirt is a dull tan puff, not a spark. A round into the ground has nothing hard to strike
        // and throws no metal, so drawing it as white fire would make the terrain look like it was
        // the interesting thing to be shooting at.
        buf.sparkCol[o] = f * 0.55; buf.sparkCol[o + 1] = f * 0.42; buf.sparkCol[o + 2] = f * 0.26;
      } else {
        // Cools white -> orange as it dies, like a real strike on armour.
        buf.sparkCol[o] = f; buf.sparkCol[o + 1] = f * (0.45 + 0.5 * f); buf.sparkCol[o + 2] = f * f * 0.55;
      }
      // Per-point size, so a dirt puff can be smaller than a strike on the hide without needing a
      // second draw call of its own.
      buf.sparkSize[nS] = (sp.kind === 'dirt' ? DIRT_M : SPARK_M) / METRES_PER_UNIT;
      nS++;
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
    S.geometry.attributes.aSize.needsUpdate = true;
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
          {/* Per-point size. PointsMaterial has one size for the whole cloud, so a strike on the
              monster and a round into the dirt would have to be two separate draws to differ. One
              line of shader patching is cheaper than a second point cloud. */}
          <bufferAttribute attach="attributes-aSize" args={[buf.sparkSize, 1]} usage={THREE.DynamicDrawUsage} />
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
          onBeforeCompile={perPointSize}
        />
      </points>
    </>
  );
}
