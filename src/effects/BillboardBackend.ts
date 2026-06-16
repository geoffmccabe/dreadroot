// InstancedBillboardBackend — the Phase-1 renderer for the universal effects
// module. Camera-facing instanced quads (no gl_PointSize cap) animated entirely
// in a STATELESS vertex shader: the CPU writes each puff's spawn pos + birth +
// seed ONCE; the shader computes rise / flutter / size / fade from a clock every
// frame. Live puffs cost ~0 CPU and zero per-frame GC.
//
// One pool (one draw call) per recipe. Each pool is a pre-allocated ring buffer
// of SOA Float32Arrays backing InstancedBufferAttributes. No per-frame
// allocation anywhere in the hot path; module-level scratch only.

import * as THREE from 'three';
import type { EffectRecipe, EffectEmitter } from './types';
import { getRecipe } from './recipes';

const TWO_PI = 6.2831853;
const _p = new THREE.Vector3(); // scratch for emitter getPos — never allocate in tick

// Stateless puff sim. center(age) is a closed-form function of birth+seed, so
// nothing is stored between frames. Dead/unborn puffs collapse off-screen (~free).
const VERT = /* glsl */ `
  attribute vec3 aSpawn;
  attribute float aBirth;
  attribute vec3 aSeed;

  uniform float uTime, uLifetime, uRise, uGravity, uSize0, uSize1, uSpin;
  uniform float uFlutterAmp, uFlutterFreq, uSpread;
  uniform float uCullDist, uFadeStart, uFadeEnd;
  uniform vec2 uWind;

  varying vec2 vUv;
  varying float vLife;
  varying float vFade;

  void main() {
    float age = uTime - aBirth;
    float life = age / uLifetime;        // 0..1
    vLife = life;
    vUv = uv;
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
  precision mediump float;
  uniform vec3 uColor0, uColor1;
  uniform float uOpacity0, uOpacity1;

  varying vec2 vUv;
  varying float vLife;
  varying float vFade;

  void main() {
    // Soft round falloff (asset-free Phase 1 — no texture dependency).
    float r = length(vUv - 0.5);
    float soft = 1.0 - smoothstep(0.32, 0.5, r);
    // Smooth fade-in over first 12%, fade-out over last 35%.
    float fadeIn = smoothstep(0.0, 0.12, vLife);
    float fadeOut = 1.0 - smoothstep(0.65, 1.0, vLife);
    float a = mix(uOpacity0, uOpacity1, vLife) * fadeIn * fadeOut * vFade * soft;
    if (a < 0.003) discard;
    vec3 col = mix(uColor0, uColor1, vLife);
    gl_FragColor = vec4(col, a);
  }
`;

interface Pool {
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

  /** The Object3D to add to the scene graph. */
  get object3D(): THREE.Object3D {
    return this.group;
  }

  setQuality(scale: number): void {
    this.qScale = scale;
  }

  private buildPool(recipe: EffectRecipe): Pool {
    const cap = recipe.maxInstances ?? this.capPerRecipe;
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

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLifetime: { value: recipe.lifetime },
        uRise: { value: recipe.rise },
        uGravity: { value: recipe.gravity },
        uSize0: { value: recipe.size0 },
        uSize1: { value: recipe.size1 },
        uSpin: { value: recipe.spin },
        uFlutterAmp: { value: recipe.flutterAmp },
        uFlutterFreq: { value: recipe.flutterFreq },
        uSpread: { value: recipe.spread },
        uWind: { value: new THREE.Vector2(recipe.wind[0], recipe.wind[1]) },
        uCullDist: { value: recipe.cullDistance },
        uFadeStart: { value: recipe.fadeStart },
        uFadeEnd: { value: recipe.fadeEnd },
        uColor0: { value: new THREE.Color(recipe.color0) },
        uColor1: { value: new THREE.Color(recipe.color1) },
        uOpacity0: { value: recipe.opacity0 },
        uOpacity1: { value: recipe.opacity1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: recipe.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false; // we cull per-puff in the shader + emit-side
    mesh.renderOrder = 996; // under the fire renderer (999) so fire draws on top
    this.group.add(mesh);

    return { recipe, mesh, material, spawn, birth, seed, aSpawn, aBirth, aSeed, cap, cursor: 0, dirty: false };
  }

  private ensurePool(recipe: EffectRecipe): Pool {
    let pool = this.pools.get(recipe.code);
    if (!pool) {
      pool = this.buildPool(recipe);
      this.pools.set(recipe.code, pool);
    }
    return pool;
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
    this.spawn(this.ensurePool(getRecipe(code)), pos.x, pos.y, pos.z, now);
  }

  emitBurst(code: string, pos: THREE.Vector3, count: number): void {
    const now = performance.now() / 1000;
    const pool = this.ensurePool(getRecipe(code));
    for (let i = 0; i < count; i++) this.spawn(pool, pos.x, pos.y, pos.z, now);
  }

  createEmitter(
    code: string,
    getPos: (out: THREE.Vector3) => boolean,
    importance = 0.3,
  ): EffectEmitter {
    // Significance eviction: if at the emitter cap, drop the lowest-importance
    // active emitter (only if it's no more important than the newcomer).
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
        return NOOP_EMITTER; // can't place; drop silently (visual-only)
      }
    }

    let rec = this.free.pop();
    if (!rec) {
      rec = { active: false, gen: 0, recipe: getRecipe(code), getPos: NOOP_GETPOS, acc: 0, importance };
      this.emitters.push(rec);
    }
    rec.active = true;
    rec.gen++;
    rec.recipe = getRecipe(code);
    rec.getPos = getPos;
    rec.acc = 0;
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

  /** Per-frame: advance emitters (emit-side cull) + bump clock + upload dirty. */
  tick(dt: number, camX: number, camZ: number): void {
    const now = performance.now() / 1000;

    for (let k = 0; k < this.emitters.length; k++) {
      const e = this.emitters[k];
      if (!e.active) continue;
      if (!e.getPos(_p)) continue; // source momentarily gone — skip this frame

      const cull = e.recipe.cullDistance;
      const dx = _p.x - camX;
      const dz = _p.z - camZ;
      if (dx * dx + dz * dz > cull * cull) {
        if (e.acc > 1) e.acc = 1; // don't bank spawns while culled
        continue;
      }

      e.acc += dt * e.recipe.spawnRate * this.qScale;
      const pool = this.ensurePool(e.recipe);
      let guard = 0;
      while (e.acc >= 1 && guard < 8) {
        e.acc -= 1;
        this.spawn(pool, _p.x, _p.y, _p.z, now);
        guard++;
      }
      if (e.acc > 2) e.acc = 2;
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
