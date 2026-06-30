// A placed "water" object: a flat horizontal surface with a Minecraft-ish look — shiny, animated,
// translucent, tinted, optionally glowing. Built on MeshPhysicalMaterial so it gets real sky/
// environment reflection for FREE (reuses the scene's IBL — no extra render passes, safe on phones).
// An onBeforeCompile hook animates the surface normals so the reflection shimmers like moving water.
// It's a normal placed object: moves/rotates/scales with the Arrange tools and shares via
// world_objects. Spawn by typing *wa. (Step 2 will add an optional quarter-res every-other-frame
// planar mirror of the actual terrain on desktop; this is the cheap tier that runs everywhere.)
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldObject } from './types';

// Per-water look (defaults for now; Step 3 wires these to per-object pickers + a DB column).
const TINT = '#2f8fb0';
const GLOW = '#5fe6ff';
const GLOW_INTENSITY = 0.35;

export function WaterObject({ obj }: { obj: WorldObject }) {
  const { mat, uniforms } = useMemo(() => {
    const uniforms = { uTime: { value: 0 } };
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(TINT),
      emissive: new THREE.Color(GLOW),
      emissiveIntensity: GLOW_INTENSITY,
      metalness: 0.0,
      roughness: 0.08,            // low = sharp, wet reflection of the sky/IBL
      transparent: true,
      opacity: 0.82,
      envMapIntensity: 1.4,       // strength of the free sky/environment reflection
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // Animate the surface normals so the reflection/highlights ripple like moving water.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;')
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          float w1 = sin(vWPos.x * 0.55 + uTime * 1.2) + cos(vWPos.z * 0.48 - uTime * 1.0);
          float w2 = sin((vWPos.x + vWPos.z) * 0.37 + uTime * 1.6);
          normal = normalize(normal + vec3(w1 * 0.10, 0.0, w2 * 0.10));`);
    };
    return { mat, uniforms };
  }, []);
  useFrame((_, dt) => { uniforms.uTime.value += dt; });
  // Plane laid flat (normal up); group pos/quat/scale come from the editor like any object.
  return (
    <group position={obj.pos} quaternion={obj.quat} scale={obj.scale} userData={{ worldObjectId: obj.id }}>
      <mesh rotation-x={-Math.PI / 2} material={mat} userData={{ worldObjectId: obj.id }}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
