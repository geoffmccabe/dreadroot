// InstancedBillboardBackend — the Phase-1 renderer for the universal effects
// module. Camera-facing instanced quads (no gl_PointSize cap) animated entirely
// in a STATELESS vertex shader: the CPU writes each puff's spawn pos + birth +
// seed ONCE; the shader computes rise / flutter / size / fade from a clock every
// frame. Live puffs cost ~0 CPU and zero per-frame GC.
//
// Each recipe drives up to TWO pools (one draw call each):
//   • body   — many small soft puffs (the smoke volume)
//   • spiral — a sparser, larger spinning inward-spiral laid on top, slightly
//              lighter, fading with the smoke (toggle add-on).
// Pools are pre-allocated SOA Float32Array ring buffers. No per-frame allocation
// in the hot path; module-level scratch only. Spawns are interpolated along the
// emitter's motion each frame so a fast mover (e.g. a grenade-launched enemy)
// leaves an EVEN trail instead of a few clustered puffs.

import * as THREE from 'three';
import type { EffectRecipe, EffectEmitter } from './types';
import { getRecipe } from './recipes';

const TWO_PI = 6.2831853;
const _p = new THREE.Vector3(); // scratch for emitter getPos — never allocate in tick

type Variant = 'body' | 'spiral';

const VERT = /* glsl */ `
  attribute vec3 aSpawn;
  attribute float aBirth;
  attribute vec3 aSeed;

  uniform float uTime, uLifetime, uRise, uGravity, uSize0, uSize1, uSpin;
  uniform float uFlutterAmp, uFlutterFreq, uSpread;
  uniform float uCullDist, uFadeStart, uFadeEnd;
  uniform float uSpinMin, uSpinMax;
  uniform vec2 uWind;

  varying vec2 vUv;
  varying float vLife;
  varying float vFade;
  varying float vSpin;       // spiral angular speed (rad/s), per-puff random
  varying float vSpinPhase;  // spiral start phase, per-puff random

  void main() {
    float age = uTime - aBirth;
    float life = age / uLifetime;        // 0..1
    vLife = life;
    vUv = uv;
    vSpin = mix(uSpinMin, uSpinMax, aSeed.x);
    vSpinPhase = aSeed.y * ${TWO_PI};
    if (life < 0.0 || life >= 1.0) {     // dead/unborn -> clip offscreen
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float ph = aSeed.z * ${TWO_PI};
    float y = uRise * age - 0.5 * uGravity * age * age;
    vec2 scatter = (aSeed.xy - 0.5) * 2.0 * uSpread;
    vec2 drift = uWind * age;
    float fx = sin(uFlutterFreq * age + ph) * uFlutterAmp;
    float fz = cos(uFlutterFreq * age + ph * 1.7) * uFlutterAmp;
    vec3 center = aSpawn + vec3(scatter.x + drift.x + fx, y, scatter.y + drift.y + fz);

    // Distance cull + fade (emit-side cull also runs on CPU; this is the backstop).
    float dx = center.x - cameraPosition.x;
    float dz = center.z - cameraPosition.z;
    float dist = sqrt(dx * dx + dz * dz);
    if (dist > uCullDist) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vFade = 1.0 - clamp((dist - uFadeStart) / max(0.001, uFadeEnd - uFadeStart), 0.0, 1.0);

    float size = mix(uSize0, uSize1, life);
    float ang = uSpin * age + ph;
    float cs = cos(ang), sn = sin(ang);
    vec2 c = position.xy;                 // base quad corner in [-0.5,0.5]
    vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);

    // View-space billboard: offset in view space => always camera-facing.
    vec4 mv = viewMatrix * vec4(center, 1.0);
    mv.xy += rc * size;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  // No explicit precision qualifier: use three's injected default (highp), which
  // MUST match the vertex shader's uTime precision — declaring uTime at mediump
  // here while the vertex uses highp makes the program fail to link on strict
  // drivers (Mac/ANGLE) and nothing renders. Keep both stages at the same precision.
  uniform float uTime;
  uniform vec3 uColor0, uColor1;
  uniform float uOpacity0, uOpacity1;
  uniform float uCircleStrength;             // 1 = body soft circle, 0 = spiral-only
  uniform float uSpiral, uSpiralLighten, uSpiralTurns;

  varying vec2 vUv;
  varying float vLife;
  varying float vFade;
  varying float vSpin;
  varying float vSpinPhase;

  void main() {
    float fadeIn = smoothstep(0.0, 0.12, vLife);
    float fadeOut = 1.0 - smoothstep(0.6, 1.0, vLife);
    float lifeFade = fadeIn * fadeOut * vFade;
    float baseOp = mix(uOpacity0, uOpacity1, vLife);
    vec3 col = mix(uColor0, uColor1, vLife);

    // Soft round body.
    float r = length(vUv - 0.5);
    float soft = 1.0 - smoothstep(0.30, 0.5, r);
    float a = uCircleStrength * baseOp * soft * lifeFade;

    // Spinning inward spiral (always spinning via uTime; fades with the puff).
    if (uSpiral > 0.5) {
      vec2 q = vUv - 0.5;
      float rr = length(q) * 2.0;          // 0 at center, 1 at edge
      if (rr < 1.0) {
        float ang = atan(q.y, q.x) / ${TWO_PI};   // -0.5..0.5
        float rot = uTime * vSpin + vSpinPhase;
        float s = ang - rr * uSpiralTurns + rot;   // winds inward over uSpiralTurns
        float f = fract(s);
        float arm = 1.0 - smoothstep(0.0, 0.16, min(f, 1.0 - f));
        float win = smoothstep(0.0, 0.12, rr) * (1.0 - smoothstep(0.65, 1.0, rr));
        float spiralA = arm * win;
        vec3 lighter = min(col + vec3(uSpiralLighten), vec3(1.0));
        col = mix(col, lighter, spiralA);
        a = max(a, spiralA * baseOp * lifeFade);
      }
    }

    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }
`;

interface Pool {
  key: string;
  variant: Variant;
  recipe: EffectRecipe;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  spawn: Float32Array;
  birth: Float32Array;
  seed: Float32Array;
  aSpawn: THREE.InstancedBufferAttribute;
  aBirth: THREE.InstancedBufferAttribute;
  aSeed: THREE.InstancedBufferAttribute;
  cap: number;
  cursor: number;
  dirty: boolean;
}

interface EmitterRec {
  active: boolean;
  gen: number;
  recipe: EffectRecipe;
  getPos: (out: THREE.Vector3) => boolean;
  acc: number;
  accSpiral: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  hasLast: boolean;
  importance: number;
}

const NOOP_GETPOS = () => false;
const NOOP_EMITTER: EffectEmitter = { stop() {} };

export interface BillboardBackendOpts {
  capPerRecipe: number;
  maxEmitters: number;
  quality: number; // spawn-rate / density scale
}

export class BillboardBackend {
  private group = new THREE.Group();
  private pools = new Map<string, Pool>();
  private emitters: EmitterRec[] = [];
  private free: EmitterRec[] = [];
  private capPerRecipe: number;
  private maxEmitters: number;
  private qScale: number;

  constructor(opts: BillboardBackendOpts) {
    this.capPerRecipe = opts.capPerRecipe;
    this.maxEmitters = opts.maxEmitters;
    this.qScale = opts.quality;
  }

  get object3D(): THREE.Object3D {
    return this.group;
  }

  setQuality(scale: number): void {
    this.qScale = scale;
  }

  private poolKey(code: string, variant: Variant): string {
    return variant === 'spiral' ? `${code}#spiral` : code;
  }

  private applyUniforms(u: Record<string, THREE.IUniform>, recipe: EffectRecipe, variant: Variant): void {
    const isSpiral = variant === 'spiral';
    const spinMaxSec = recipe.spiralSpinMaxSec ?? 1.0;
    const spinMinSec = recipe.spiralSpinMinSec ?? 0.5;
    u.uLifetime.value = recipe.lifetime;
    u.uRise.value = recipe.rise;
    u.uGravity.value = recipe.gravity;
    u.uSize0.value = isSpiral ? (recipe.spiralSize0 ?? 0.4) : recipe.size0;
    u.uSize1.value = isSpiral ? (recipe.spiralSize1 ?? 1.1) : recipe.size1;
    u.uSpin.value = isSpiral ? 0 : recipe.spin; // spiral spins in-shader, not the quad
    u.uFlutterAmp.value = recipe.flutterAmp;
    u.uFlutterFreq.value = recipe.flutterFreq;
    u.uSpread.value = recipe.spread;
    (u.uWind.value as THREE.Vector2).set(recipe.wind[0], recipe.wind[1]);
    u.uCullDist.value = recipe.cullDistance;
    u.uFadeStart.value = recipe.fadeStart;
    u.uFadeEnd.value = recipe.fadeEnd;
    (u.uColor0.value as THREE.Color).set(recipe.color0);
    (u.uColor1.value as THREE.Color).set(recipe.color1);
    u.uOpacity0.value = isSpiral ? (recipe.spiralOpacity ?? 0.5) : recipe.opacity0;
    u.uOpacity1.value = 0.0;
    u.uCircleStrength.value = isSpiral ? 0.0 : 1.0;
    u.uSpiral.value = isSpiral ? 1.0 : 0.0;
    u.uSpiralLighten.value = recipe.spiralLighten ?? 0.22;
    u.uSpiralTurns.value = recipe.spiralTurns ?? 2;
    u.uSpinMin.value = TWO_PI / spinMaxSec; // slow end (rad/s)
    u.uSpinMax.value = TWO_PI / spinMinSec; // fast end (rad/s)
  }

  private buildPool(recipe: EffectRecipe, variant: Variant): Pool {
    const cap = variant === 'spiral'
      ? Math.min(1200, recipe.maxInstances ?? this.capPerRecipe)
      : (recipe.maxInstances ?? this.capPerRecipe);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);

    const spawn = new Float32Array(cap * 3);
    const birth = new Float32Array(cap).fill(-1e9); // all start dead
    const seed = new Float32Array(cap * 3);
    for (let i = 0; i < cap * 3; i++) seed[i] = Math.random();

    const aSpawn = new THREE.InstancedBufferAttribute(spawn, 3).setUsage(THREE.DynamicDrawUsage);
    const aBirth = new THREE.InstancedBufferAttribute(birth, 1).setUsage(THREE.DynamicDrawUsage);
    const aSeed = new THREE.InstancedBufferAttribute(seed, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSpawn', aSpawn);
    geo.setAttribute('aBirth', aBirth);
    geo.setAttribute('aSeed', aSeed);
    geo.instanceCount = cap;

    const u: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uLifetime: { value: 1 }, uRise: { value: 0 }, uGravity: { value: 0 },
      uSize0: { value: 0.1 }, uSize1: { value: 1 }, uSpin: { value: 0 },
      uFlutterAmp: { value: 0 }, uFlutterFreq: { value: 1 }, uSpread: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      uCullDist: { value: 100 }, uFadeStart: { value: 80 }, uFadeEnd: { value: 100 },
      uColor0: { value: new THREE.Color() }, uColor1: { value: new THREE.Color() },
      uOpacity0: { value: 0.5 }, uOpacity1: { value: 0 },
      uCircleStrength: { value: 1 },
      uSpiral: { value: 0 }, uSpiralLighten: { value: 0.22 }, uSpiralTurns: { value: 2 },
      uSpinMin: { value: TWO_PI }, uSpinMax: { value: 2 * TWO_PI },
    };
    this.applyUniforms(u, recipe, variant);

    const material = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: recipe.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = variant === 'spiral' ? 997 : 996; // spiral over body, both under fire(999)
    this.group.add(mesh);

    return {
      key: this.poolKey(recipe.code, variant), variant, recipe, mesh, material,
      spawn, birth, seed, aSpawn, aBirth, aSeed, cap, cursor: 0, dirty: false,
    };
  }

  private ensurePool(recipe: EffectRecipe, variant: Variant): Pool {
    const key = this.poolKey(recipe.code, variant);
    let pool = this.pools.get(key);
    if (!pool) {
      pool = this.buildPool(recipe, variant);
      this.pools.set(key, pool);
    }
    return pool;
  }

  /** Live-update an already-built pool's uniforms (admin preview). */
  updateRecipe(recipe: EffectRecipe): void {
    for (const variant of ['body', 'spiral'] as Variant[]) {
      const pool = this.pools.get(this.poolKey(recipe.code, variant));
      if (!pool) continue;
      this.applyUniforms(pool.material.uniforms, recipe, variant);
      const blend = recipe.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (pool.material.blending !== blend) {
        pool.material.blending = blend;
        pool.material.needsUpdate = true;
      }
      pool.recipe = recipe;
    }
  }

  private spawn(pool: Pool, x: number, y: number, z: number, now: number): void {
    const i = pool.cursor;
    pool.spawn[i * 3] = x;
    pool.spawn[i * 3 + 1] = y;
    pool.spawn[i * 3 + 2] = z;
    pool.birth[i] = now;
    pool.seed[i * 3] = Math.random();
    pool.seed[i * 3 + 1] = Math.random();
    pool.seed[i * 3 + 2] = Math.random();
    pool.cursor = (i + 1) % pool.cap;
    pool.dirty = true;
  }

  emitPuff(code: string, pos: THREE.Vector3): void {
    const now = performance.now() / 1000;
    this.spawn(this.ensurePool(getRecipe(code), 'body'), pos.x, pos.y, pos.z, now);
  }

  emitBurst(code: string, pos: THREE.Vector3, count: number): void {
    const now = performance.now() / 1000;
    const recipe = getRecipe(code);
    const body = this.ensurePool(recipe, 'body');
    for (let i = 0; i < count; i++) this.spawn(body, pos.x, pos.y, pos.z, now);
    if (recipe.spiral) {
      const sp = this.ensurePool(recipe, 'spiral');
      const sc = Math.max(1, Math.round(count * 0.15));
      for (let i = 0; i < sc; i++) this.spawn(sp, pos.x, pos.y, pos.z, now);
    }
  }

  createEmitter(
    code: string,
    getPos: (out: THREE.Vector3) => boolean,
    importance = 0.3,
  ): EffectEmitter {
    let activeCount = 0;
    for (let i = 0; i < this.emitters.length; i++) if (this.emitters[i].active) activeCount++;
    if (activeCount >= this.maxEmitters) {
      let lo: EmitterRec | null = null;
      for (let i = 0; i < this.emitters.length; i++) {
        const e = this.emitters[i];
        if (e.active && (!lo || e.importance < lo.importance)) lo = e;
      }
      if (lo && lo.importance <= importance) {
        lo.active = false;
        lo.getPos = NOOP_GETPOS;
        this.free.push(lo);
      } else {
        return NOOP_EMITTER;
      }
    }

    let rec = this.free.pop();
    if (!rec) {
      rec = {
        active: false, gen: 0, recipe: getRecipe(code), getPos: NOOP_GETPOS,
        acc: 0, accSpiral: 0, lastX: 0, lastY: 0, lastZ: 0, hasLast: false, importance,
      };
      this.emitters.push(rec);
    }
    rec.active = true;
    rec.gen++;
    rec.recipe = getRecipe(code);
    rec.getPos = getPos;
    rec.acc = 0;
    rec.accSpiral = 0;
    rec.hasLast = false;
    rec.importance = importance;

    const myGen = rec.gen;
    const self = this;
    return {
      stop() {
        if (rec!.active && rec!.gen === myGen) {
          rec!.active = false;
          rec!.getPos = NOOP_GETPOS;
          self.free.push(rec!);
        }
      },
    };
  }

  tick(dt: number, camX: number, camZ: number): void {
    const now = performance.now() / 1000;

    for (let k = 0; k < this.emitters.length; k++) {
      const e = this.emitters[k];
      if (!e.active) continue;
      if (!e.getPos(_p)) continue;

      const recipe = e.recipe;
      const cull = recipe.cullDistance;
      const dx = _p.x - camX;
      const dz = _p.z - camZ;
      if (dx * dx + dz * dz > cull * cull) {
        if (e.acc > 1) e.acc = 1;
        if (e.accSpiral > 1) e.accSpiral = 1;
        e.lastX = _p.x; e.lastY = _p.y; e.lastZ = _p.z; e.hasLast = true;
        continue;
      }
      if (!e.hasLast) { e.lastX = _p.x; e.lastY = _p.y; e.lastZ = _p.z; e.hasLast = true; }

      // Body: interpolate spawns along last->current so a fast mover trails evenly.
      e.acc += dt * recipe.spawnRate * this.qScale;
      let n = 0;
      while (e.acc >= 1 && n < 48) { e.acc -= 1; n++; }
      if (e.acc > 3) e.acc = 3;
      if (n > 0) {
        const body = this.ensurePool(recipe, 'body');
        for (let i = 0; i < n; i++) {
          const t = (i + 1) / n;
          this.spawn(body, e.lastX + (_p.x - e.lastX) * t, e.lastY + (_p.y - e.lastY) * t, e.lastZ + (_p.z - e.lastZ) * t, now);
        }
      }

      // Spiral: sparser layer, same interpolation.
      if (recipe.spiral) {
        e.accSpiral += dt * (recipe.spiralRate ?? 8) * this.qScale;
        let m = 0;
        while (e.accSpiral >= 1 && m < 12) { e.accSpiral -= 1; m++; }
        if (e.accSpiral > 2) e.accSpiral = 2;
        if (m > 0) {
          const sp = this.ensurePool(recipe, 'spiral');
          for (let i = 0; i < m; i++) {
            const t = (i + 1) / m;
            this.spawn(sp, e.lastX + (_p.x - e.lastX) * t, e.lastY + (_p.y - e.lastY) * t, e.lastZ + (_p.z - e.lastZ) * t, now);
          }
        }
      }

      e.lastX = _p.x; e.lastY = _p.y; e.lastZ = _p.z;
    }

    for (const pool of this.pools.values()) {
      pool.material.uniforms.uTime.value = now;
      if (pool.dirty) {
        pool.aSpawn.needsUpdate = true;
        pool.aBirth.needsUpdate = true;
        pool.aSeed.needsUpdate = true;
        pool.dirty = false;
      }
    }
  }

  dispose(): void {
    for (const pool of this.pools.values()) {
      this.group.remove(pool.mesh);
      pool.mesh.geometry.dispose();
      pool.material.dispose();
    }
    this.pools.clear();
    this.emitters.length = 0;
    this.free.length = 0;
  }
}
