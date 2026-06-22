// siegeWind — a subtle leaf-flutter vertex sway for foliage materials. One shared time uniform
// (advanced once per frame in WorldObjectsLayer) drives an onBeforeCompile vertex offset, so it's
// just a few sin/cos in the vertex stage — negligible FPS cost, works on InstancedMesh (per-
// instance phase from instanceMatrix). Sway scales with local height so trunks stay put and the
// canopy moves most.
import * as THREE from 'three';

export const windTime = { value: 0 };

export function applyLeafWind(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 _iw = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 _iw = vec3(0.0);
        #endif
        float _ph = uWindTime * 1.4 + _iw.x * 0.12 + _iw.z * 0.12;
        float _h = max(0.0, position.y);            // local height — canopy sways, base doesn't
        transformed.x += sin(_ph) * 0.02 * _h;
        transformed.z += cos(_ph * 1.1) * 0.016 * _h;`,
    );
  };
  mat.needsUpdate = true;
}
