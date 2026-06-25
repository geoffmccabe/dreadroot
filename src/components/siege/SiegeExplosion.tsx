// SiegeExplosion — a three.js recreation of the Siege Worlds (Unity) rocket-launcher blast.
// The Unity prefab (Assets/Resources/gfx/rocket_explosion.prefab) is 5 billboard particle
// systems sharing one soft round sprite, in two materials: ADDITIVE (fireball + rising embers)
// and ALPHA-blend dark (smoke puff, sparks, falling debris). All burst once at t=0. We mirror
// that with two THREE.Points clouds + a procedural radial-glow texture. Call `burst(x,y,z,scale)`
// to fire one. Designed to play ALONGSIDE the existing grenade VFX, not replace it.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface SiegeExplosionHandle {
  burst: (x: number, y: number, z: number, scale?: number) => void;
}

const POOL = 1400;          // per-cloud particle cap
const SIZE_PX = 320;        // world-size → screen px scale (tuned for the soft sprite)
const GRAV = 9.8;

// The REAL Synty particle sprites (POLYGON ParticleFX pack) used by the Unity rocket blast:
// Circle_01 = the soft additive glow (fire/embers/sparks), Smoke_01 = the soft smoke puff.
function loadTex(url: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

type Grad = { t: number; c: [number, number, number]; a: number }[];
interface SysCfg {
  add: boolean;        // additive (fire/ember) vs alpha (smoke/spark/debris)
  count: number;
  life: [number, number];
  speed: [number, number];
  size: [number, number];
  coneDeg: number;     // half-angle of the upward emission cone
  grav: number;        // signed gravity modifier (× GRAV)
  drag: number;        // per-second velocity damp
  grad: Grad;
  grow: (f: number) => number;   // size multiplier over life fraction f (0..1)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// fireball: fast grow-in then expand to full; smoke same. debris: hold then shrink. ember: pulse.
const GROW_OUT = (f: number) => f < 0.05 ? lerp(0.08, 0.81, f / 0.05) : lerp(0.81, 1, (f - 0.05) / 0.95);
const HOLD_SHRINK = (f: number) => f < 0.66 ? 1 : lerp(1, 0, (f - 0.66) / 0.34);
const PULSE = (f: number) => f < 0.44 ? f / 0.44 : 1 - (f - 0.44) / 0.56;

const SYS: SysCfg[] = [
  { // Fire_01 — the fireball: yellow-orange → orange → deep red, expands, fades
    add: true, count: 46, life: [0.5, 1.6], speed: [1, 14], size: [0.6, 1.6], coneDeg: 45, grav: 0.1, drag: 1.5,
    grad: [{ t: 0, c: [1, 0.6, 0.15], a: 0 }, { t: 0.12, c: [1, 0.7, 0.3], a: 1 }, { t: 0.55, c: [1, 0.34, 0], a: 1 }, { t: 0.85, c: [0.5, 0.03, 0], a: 0.6 }, { t: 1, c: [0.25, 0, 0], a: 0 }], grow: GROW_OUT },
  { // smoke — dark grey puff, rises slightly, fades
    add: false, count: 26, life: [0.7, 2.2], speed: [1, 9], size: [0.8, 1.8], coneDeg: 50, grav: 0.1, drag: 1.2,
    grad: [{ t: 0, c: [0.18, 0.16, 0.15], a: 0 }, { t: 0.15, c: [0.16, 0.15, 0.14], a: 0.85 }, { t: 1, c: [0.1, 0.1, 0.1], a: 0 }], grow: GROW_OUT },
  { // Debris_01 — fast orange sparks, short-lived
    add: true, count: 34, life: [0.4, 1.1], speed: [9, 26], size: [0.18, 0.5], coneDeg: 38, grav: 0.4, drag: 1.0,
    grad: [{ t: 0, c: [1, 0.55, 0.1], a: 1 }, { t: 0.35, c: [1, 0.3, 0], a: 1 }, { t: 1, c: [0.2, 0, 0], a: 0 }], grow: HOLD_SHRINK },
  { // Debris_02 — small smoke-trail chunks, arc up and fall, linger
    add: false, count: 22, life: [1.5, 3.0], speed: [3, 16], size: [0.12, 0.3], coneDeg: 42, grav: 1.0, drag: 0.2,
    grad: [{ t: 0, c: [0.2, 0.18, 0.16], a: 0.8 }, { t: 1, c: [0.5, 0.5, 0.5], a: 0 }], grow: HOLD_SHRINK },
  { // Embers_01 — glowing dots that rise and fade
    add: true, count: 28, life: [0.8, 2.6], speed: [1, 6], size: [0.1, 0.22], coneDeg: 70, grav: -0.15, drag: 0.8,
    grad: [{ t: 0, c: [1, 0.7, 0.1], a: 0 }, { t: 0.2, c: [1, 0.5, 0.05], a: 1 }, { t: 1, c: [1, 0.05, 0], a: 0 }], grow: PULSE },
];

function gradAt(grad: Grad, f: number, out: THREE.Vector4) {
  for (let i = 1; i < grad.length; i++) {
    if (f <= grad[i].t || i === grad.length - 1) {
      const a = grad[i - 1], b = grad[i];
      const u = b.t === a.t ? 0 : Math.min(1, Math.max(0, (f - a.t) / (b.t - a.t)));
      out.set(lerp(a.c[0], b.c[0], u), lerp(a.c[1], b.c[1], u), lerp(a.c[2], b.c[2], u), lerp(a.a, b.a, u));
      return;
    }
  }
}

interface Cloud {
  pos: Float32Array; col: Float32Array; siz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; max: Float32Array; size0: Float32Array; sysi: Int8Array;
  cursor: number; aliveCount: number; geo: THREE.BufferGeometry;
}
function makeCloud(): Cloud {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(POOL * 3), col = new Float32Array(POOL * 4), siz = new Float32Array(POOL);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setDrawRange(0, POOL);
  return {
    pos, col, siz,
    vx: new Float32Array(POOL), vy: new Float32Array(POOL), vz: new Float32Array(POOL),
    life: new Float32Array(POOL), max: new Float32Array(POOL), size0: new Float32Array(POOL), sysi: new Int8Array(POOL),
    cursor: 0, aliveCount: 0, geo,
  };
}

const VERT = `
attribute vec4 aColor; attribute float aSize; varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (${SIZE_PX.toFixed(1)} / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uTex; varying vec4 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  if (vColor.a * t.a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a) * t;
}`;

export const SiegeExplosion = forwardRef<SiegeExplosionHandle>((_, ref) => {
  const fireTex = useMemo(() => loadTex('/siege/vfx/PolygonParticles_Circle_01.png'), []);
  const smokeTex = useMemo(() => loadTex('/siege/vfx/PolygonParticles_Smoke_01.png'), []);
  const addCloud = useRef<Cloud>(); if (!addCloud.current) addCloud.current = makeCloud();
  const alpCloud = useRef<Cloud>(); if (!alpCloud.current) alpCloud.current = makeCloud();
  const addMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: { uTex: { value: fireTex } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), [fireTex]);
  const alpMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: { uTex: { value: smokeTex } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.NormalBlending }), [smokeTex]);
  const _v = useMemo(() => new THREE.Vector4(), []);

  const burst = useMemo(() => (x: number, y: number, z: number, scale = 1) => {
      for (let si = 0; si < SYS.length; si++) {
        const cfg = SYS[si];
        const cloud = cfg.add ? addCloud.current! : alpCloud.current!;
        const cone = (cfg.coneDeg * Math.PI) / 180;
        for (let k = 0; k < cfg.count; k++) {
          const i = cloud.cursor; cloud.cursor = (cloud.cursor + 1) % POOL;
          if (cloud.life[i] <= 0) cloud.aliveCount++;   // only count NEW slots (not overwrites)
          // direction in an upward cone
          const az = Math.random() * Math.PI * 2;
          const polar = Math.random() * cone;
          const sp = lerp(cfg.speed[0], cfg.speed[1], Math.random()) * scale;
          const sinP = Math.sin(polar);
          cloud.vx[i] = Math.cos(az) * sinP * sp;
          cloud.vy[i] = Math.cos(polar) * sp;
          cloud.vz[i] = Math.sin(az) * sinP * sp;
          cloud.pos[i * 3] = x; cloud.pos[i * 3 + 1] = y + 0.3; cloud.pos[i * 3 + 2] = z;
          cloud.size0[i] = lerp(cfg.size[0], cfg.size[1], Math.random()) * scale;
          cloud.max[i] = cloud.life[i] = lerp(cfg.life[0], cfg.life[1], Math.random());
          cloud.sysi[i] = si;
        }
      }
    }, []);
  useImperativeHandle(ref, () => ({ burst }), [burst]);

  useFrame((_s, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    for (const cloud of [addCloud.current!, alpCloud.current!]) {
      if (cloud.aliveCount <= 0) continue;   // idle → no work, no GPU upload
      for (let i = 0; i < POOL; i++) {
        if (cloud.life[i] <= 0) { if (cloud.siz[i] !== 0) cloud.siz[i] = 0; continue; }
        cloud.life[i] -= dt;
        if (cloud.life[i] <= 0) { cloud.siz[i] = 0; cloud.aliveCount--; continue; }
        const cfg = SYS[cloud.sysi[i]];
        const f = 1 - cloud.life[i] / cloud.max[i];
        // integrate
        cloud.vy[i] += cfg.grav * GRAV * dt;
        const damp = 1 - cfg.drag * dt;
        cloud.vx[i] *= damp; cloud.vy[i] *= damp; cloud.vz[i] *= damp;
        cloud.pos[i * 3] += cloud.vx[i] * dt;
        cloud.pos[i * 3 + 1] += cloud.vy[i] * dt;
        cloud.pos[i * 3 + 2] += cloud.vz[i] * dt;
        // color + size
        gradAt(cfg.grad, f, _v);
        cloud.col[i * 4] = _v.x; cloud.col[i * 4 + 1] = _v.y; cloud.col[i * 4 + 2] = _v.z; cloud.col[i * 4 + 3] = _v.w;
        cloud.siz[i] = cloud.size0[i] * cfg.grow(f);
      }
      (cloud.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (cloud.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
      (cloud.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <>
      <points frustumCulled={false} geometry={addCloud.current!.geo} material={addMat} />
      <points frustumCulled={false} geometry={alpCloud.current!.geo} material={alpMat} />
    </>
  );
});
SiegeExplosion.displayName = 'SiegeExplosion';

// ── Global fire-and-forget API (mirrors fireGhostExplosion) ────────────────────
// Callers (e.g. DancingDemon) fire a blast without holding a ref. A single mounted
// <SiegeExplosions/> manager subscribes and routes each call to one pooled SiegeExplosion
// (its particle pool handles overlapping bursts). Cosmetic only — no damage.
interface Fire { x: number; y: number; z: number; scale: number }
const fireSubs = new Set<(f: Fire) => void>();

/** Fire one Siege rocket-blast at a world point (visual only). */
export function fireSiegeExplosion(x: number, y: number, z: number, scale = 1) {
  fireSubs.forEach((cb) => cb({ x, y, z, scale }));
}

/** Mount ONCE (e.g. in SiegeWorldLayers) — replays every fireSiegeExplosion() call. */
export function SiegeExplosions() {
  const ref = useRef<SiegeExplosionHandle>(null);
  useEffect(() => {
    const on = (f: Fire) => ref.current?.burst(f.x, f.y, f.z, f.scale);
    fireSubs.add(on); return () => { fireSubs.delete(on); };
  }, []);
  return <SiegeExplosion ref={ref} />;
}
