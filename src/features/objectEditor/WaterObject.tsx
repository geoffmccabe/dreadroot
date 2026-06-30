// A placed "water" object: a flat horizontal surface (the top face of the flat box the user thinks
// of) with an animated, glowing, translucent water shader. It's a normal placed object, so it moves/
// rotates/scales through the same Arrange tools and persists in the shared world_objects table like
// anything else. Spawn it by typing *wa (see ObjectEditController). The look is v1 — ripple + fresnel
// glow, no true mirror reflections yet (those are a bigger perf cost; can be added later).
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldObject } from './types';

const VERT = `
varying vec2 vUv; varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = `
precision highp float;
uniform float uTime; uniform vec3 uColor; uniform vec3 uGlow; uniform float uOpacity;
varying vec2 vUv; varying vec3 vWorld;
void main() {
  // two crossing ripple bands + a fine shimmer
  float r = (sin(vUv.x * 18.0 + uTime * 1.3) * 0.5 + 0.5) * (sin(vUv.y * 14.0 - uTime * 1.1) * 0.5 + 0.5);
  float ripple = smoothstep(0.55, 1.0, r);
  float shimmer = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 28.0 + uTime * 2.0);
  vec3 col = uColor + uGlow * (0.15 + 0.6 * ripple) + shimmer * 0.04;
  // fresnel rim glow (brighter at grazing view angles) — cameraPosition is a three.js built-in
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(V.y, 0.0), 3.0);
  col += uGlow * fres * 0.8;
  // soft fade at the pool edge
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(0.0, 0.06, 1.0 - vUv.x)
             * smoothstep(0.0, 0.06, vUv.y) * smoothstep(0.0, 0.06, 1.0 - vUv.y);
  float alpha = max(uOpacity * mix(0.6, 1.0, ripple) * (0.35 + 0.65 * edge), fres * 0.5);
  gl_FragColor = vec4(col, alpha);
}`;

export function WaterObject({ obj }: { obj: WorldObject }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#1f6f8f') },
      uGlow: { value: new THREE.Color('#5fe6ff') },
      uOpacity: { value: 0.72 },
    },
    vertexShader: VERT, fragmentShader: FRAG,
  }), []);
  useFrame((_, dt) => { mat.uniforms.uTime.value += dt; });
  // Plane laid flat (normal up); group pos/quat/scale come from the editor like any object.
  return (
    <group position={obj.pos} quaternion={obj.quat} scale={obj.scale} userData={{ worldObjectId: obj.id }}>
      <mesh rotation-x={-Math.PI / 2} material={mat} userData={{ worldObjectId: obj.id }}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
