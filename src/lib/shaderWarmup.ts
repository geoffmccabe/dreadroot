import * as THREE from 'three';
import {
  createAtlasLambertMaterial,
  createAtlasStandardMaterial,
  createAtlasHueShiftMaterial,
} from '@/lib/atlasMaterial';
import { getSharedAtlasMaterial } from '@/components/InstancedAtlasBlockGroup';

let _warmed = false;
// Keep warm-up materials alive for the session: disposing a material drops
// its compiled program from the renderer's cache (when usedTimes hits 0),
// which would undo the warm-up. A few retained materials is negligible.
const _keepAlive: THREE.Material[] = [];

/**
 * Compile the game's heavy shader programs up front by rendering each
 * material once into a 1x1 offscreen target.
 *
 * Why: macOS compiles WebGL shaders through Metal, which can take 1-2s PER
 * program the first time. Three.js's normal render path blocks on that
 * compile (it has no skip-until-ready in the live render loop), so a shader
 * compiling lazily mid-game freezes the main thread — the 2026-05-22 trace
 * caught a 2767ms stall this way. Running it here, while the loading screen
 * is up, moves that unavoidable cost out of gameplay.
 *
 * Safe to call repeatedly — only the first call does work.
 */
export function warmUpShaders(
  renderer: THREE.WebGLRenderer,
  atlasTexture: THREE.Texture,
): void {
  if (_warmed) return;
  _warmed = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 3;
  scene.add(new THREE.DirectionalLight(0xffffff, 1));
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const tempGeometries: THREE.BufferGeometry[] = [];

  const addWarmMesh = (material: THREE.Material) => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // The atlas shaders declare these instanced attributes — provide them so
    // the warm-up render exercises the same program the game will use.
    geo.setAttribute('instanceUvOffset', new THREE.InstancedBufferAttribute(new Float32Array([0, 0]), 2));
    geo.setAttribute('instanceHueShift', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    geo.setAttribute('instanceEffects', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    const mesh = new THREE.InstancedMesh(geo, material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    tempGeometries.push(geo);
  };

  // Tree blocks — the exact shared material instance the game renders with.
  addWarmMesh(getSharedAtlasMaterial(atlasTexture));

  // Enemy material variants. Fresh instances, but built by the same factory
  // as the renderers' instances, so they share a program-cache key and the
  // renderers reuse this compiled program. Kept alive so it isn't evicted.
  const lambert = createAtlasLambertMaterial(atlasTexture);
  const standard = createAtlasStandardMaterial(atlasTexture);
  const hueShift = createAtlasHueShiftMaterial(atlasTexture);
  _keepAlive.push(lambert, standard, hueShift);
  addWarmMesh(lambert);
  addWarmMesh(standard);
  addWarmMesh(hueShift);

  // Render once into a 1x1 offscreen target — nothing reaches the screen,
  // but every program is fully compiled + linked synchronously right here.
  const target = new THREE.WebGLRenderTarget(1, 1);
  const prevTarget = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } catch {
    // warm-up is best-effort; never let it break startup
  } finally {
    renderer.setRenderTarget(prevTarget);
  }

  // Free the throwaway geometries + target. NOT the materials (see above).
  for (const g of tempGeometries) g.dispose();
  target.dispose();
}
