// Procedural sky cloud layer using FBM noise on a large horizontal plane.
// Renders imperatively via Three.js scene.add() for reliable rendering.

import * as THREE from 'three';
import type { CloudLayerSettings } from './FortressTypes';

// Plane size — well beyond camera far clip so geometry edges are never visible
const PLANE_SIZE = 6000;

const CLOUD_VERTEX = /* glsl */ `
  varying vec2 vWorldXZ;
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldXZ = worldPos.xz;
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uCoverage;
  uniform float uOpacity;
  uniform vec2  uWindDir;
  uniform float uSpeed;
  uniform float uScale;
  uniform vec3  uColor;
  uniform float uLightingPct;
  uniform vec3  uCameraPos;
  uniform float uFarClip;

  varying vec2 vWorldXZ;
  varying vec3 vWorldPos;

  // --- Value noise using integer hash (no sin for GPU portability) ---
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amp * noise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return value;
  }

  void main() {
    // Scale world coords into noise space, then offset by wind
    vec2 uv = vWorldXZ * uScale * 0.001 + uWindDir * uSpeed * uTime;
    float n = fbm(uv);

    // Cloud shape: smoothstep threshold based on coverage
    float cloud = smoothstep(1.0 - uCoverage, 1.0, n);
    cloud *= smoothstep(0.0, 0.3, cloud);

    // Distance fade — smoothly dissolve before the far clip cuts geometry
    float distToCamera = distance(vWorldPos, uCameraPos);
    float fadeDist = uFarClip * 0.92;  // start fading at 92% of far clip
    float distFade = 1.0 - smoothstep(fadeDist, uFarClip, distToCamera);

    // Tint clouds by lighting (darker at night)
    vec3 col = uColor * mix(0.15, 1.0, uLightingPct);

    float alpha = cloud * uOpacity * distFade;
    if (alpha < 0.005) discard;

    gl_FragColor = vec4(col, alpha);
  }
`;

export interface CloudMeshHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  update: (settings: CloudLayerSettings, camera: THREE.Camera, delta: number, lightingPct: number) => void;
  dispose: () => void;
}

export function createCloudMesh(): CloudMeshHandle {
  const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uCoverage: { value: 0.5 },
      uOpacity: { value: 0.45 },
      uWindDir: { value: new THREE.Vector2(0.707, 0.707) },
      uSpeed: { value: 0.005 },
      uScale: { value: 2.0 },
      uColor: { value: new THREE.Color('#ffffff') },
      uLightingPct: { value: 0.5 },
      uCameraPos: { value: new THREE.Vector3() },
      uFarClip: { value: 1200 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;

  const update = (settings: CloudLayerSettings, camera: THREE.Camera, delta: number, lightingPct: number) => {
    mesh.visible = settings.enabled;
    if (!settings.enabled) return;

    material.uniforms.uTime.value += delta;
    material.uniforms.uCoverage.value = settings.coverage;
    material.uniforms.uOpacity.value = settings.opacity;

    // Convert direction degrees to a unit vector
    // 0° = north (+Z), 90° = east (+X)
    const rad = (settings.direction ?? 45) * Math.PI / 180;
    material.uniforms.uWindDir.value.set(Math.sin(rad), Math.cos(rad));
    // Speed in noise-space units/sec — slider 0-50 maps to visible drift
    material.uniforms.uSpeed.value = settings.speed * 0.002;

    material.uniforms.uScale.value = settings.scale;
    material.uniforms.uColor.value.set(settings.color);
    material.uniforms.uLightingPct.value = lightingPct;

    // Pass camera position for distance fade
    material.uniforms.uCameraPos.value.copy(camera.position);

    mesh.position.set(camera.position.x, settings.height, camera.position.z);
  };

  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };

  return { mesh, material, update, dispose };
}
