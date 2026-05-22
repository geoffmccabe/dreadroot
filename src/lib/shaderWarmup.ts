/**
 * Shader warm-up. Compile every material flavour the game uses *during* the
 * loading screen, so new block types / enemies don't trigger a freeze when
 * they first render mid-game.
 *
 * Why this works: Three.js caches compiled programs keyed on material flags
 * + defines. As long as two materials have the same flags & onBeforeCompile
 * factory, they share a program. So compiling ONE of each flavour up front
 * is enough — real instances reuse the cached program instantly.
 *
 * Materials warmed (covering everything that has been seen to stall):
 *   1. Atlas Lambert  (createAtlasLambertMaterial   — used by enemies / blocks)
 *   2. Atlas Standard (createAtlasStandardMaterial  — used by enemies / fruits)
 *   3. Atlas HueShift (createAtlasHueShiftMaterial  — used by shwarms)
 *   4. MeshStandardMaterial (regular non-tree blocks)
 *   5. MeshStandardMaterial with emissiveMap (glowing blocks)
 *   6. MeshPhysicalMaterial transparent (the heaviest — glass-like blocks)
 *
 * Materials are kept alive forever — disposing them would drop their cached
 * programs (Three deletes a program when its last referencing material is
 * disposed).
 */
import * as THREE from 'three';
import {
  createAtlasLambertMaterial,
  createAtlasStandardMaterial,
  createAtlasHueShiftMaterial,
} from '@/lib/atlasMaterial';

let _ctx: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
} | null = null;
let _warmed = false;
const _keepAlive: Array<THREE.Material | THREE.Texture> = [];

export function registerWarmupContext(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  _ctx = { renderer, scene, camera };
}

export function warmUpShaders(atlasTexture: THREE.Texture | null): void {
  if (_warmed) return;
  if (!_ctx) {
    console.warn('[shaderWarmup] no context registered — skipping');
    return;
  }
  _warmed = true;
  const { renderer, scene, camera } = _ctx;

  // Shared 1x1 white placeholder for non-atlas materials. Kept alive so the
  // warmup materials' map references don't dangle.
  const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  placeholder.needsUpdate = true;
  _keepAlive.push(placeholder);

  // Geometry with the instanced attributes the atlas onBeforeCompile shaders
  // declare. Geometry is per-mesh because InstancedBufferAttribute can't be
  // safely shared across instanced meshes of different counts.
  const makeGeo = () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.setAttribute('instanceUvOffset', new THREE.InstancedBufferAttribute(new Float32Array([0, 0]), 2));
    g.setAttribute('instanceHueShift', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    g.setAttribute('instanceEffects',  new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    return g;
  };

  const meshes: THREE.InstancedMesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const addMesh = (material: THREE.Material) => {
    const g = makeGeo();
    const m = new THREE.InstancedMesh(g, material, 1);
    // Park it in front of the camera so it survives frustum culling, with
    // frustumCulled also off to be safe.
    m.setMatrixAt(0, new THREE.Matrix4().setPosition(
      camera.position.x,
      camera.position.y,
      camera.position.z - 5,
    ));
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    scene.add(m);
    meshes.push(m);
    geos.push(g);
    _keepAlive.push(material);
  };

  // 1-3: atlas-based material variants (only if atlas texture is ready).
  if (atlasTexture) {
    addMesh(createAtlasLambertMaterial(atlasTexture));
    addMesh(createAtlasStandardMaterial(atlasTexture));
    addMesh(createAtlasHueShiftMaterial(atlasTexture));
  }
  // 4: regular non-tree block (MeshStandardMaterial with map).
  addMesh(new THREE.MeshStandardMaterial({ map: placeholder, color: 0xffffff }));
  // 5: emissive non-tree block.
  addMesh(new THREE.MeshStandardMaterial({
    map: placeholder, color: 0xffffff,
    emissiveMap: placeholder, emissive: 0xffffff,
    emissiveIntensity: 0.4, roughness: 0.8, metalness: 0.1,
  }));
  // 6: transparent PhysicalMaterial — the heaviest compile.
  addMesh(new THREE.MeshPhysicalMaterial({
    map: placeholder, color: 0xffffff,
    transparent: true, opacity: 0.6,
    transmission: 0.5, thickness: 0.5,
    roughness: 0.1, metalness: 0.2,
    clearcoat: 1.0, clearcoatRoughness: 0.1,
    ior: 1.5, reflectivity: 0.7, envMapIntensity: 1.2,
  }));

  // Render the whole real scene (which now contains the warmup meshes plus
  // anything else mounted at this moment — chunks, sky, ground, lights, fog)
  // to a tiny offscreen target. Synchronous: compiles + uploads every
  // material it touches with the REAL lighting + fog state.
  const target = new THREE.WebGLRenderTarget(2, 2);
  const prevTarget = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } catch (e) {
    console.warn('[shaderWarmup] render failed:', e);
  } finally {
    renderer.setRenderTarget(prevTarget);
  }

  // Remove warmup meshes from the scene (cached programs stay because their
  // materials are still referenced via _keepAlive).
  for (const m of meshes) scene.remove(m);
  for (const g of geos) g.dispose();
  target.dispose();
}
