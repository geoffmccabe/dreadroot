// Shimmering translucent force-field on the Fortress Safe Zone perimeter (DreadRoot
// only) — the boundary monsters cannot cross. Purely visual; the exclusion is already
// enforced by the FSZ logic. Four very tall vertical walls on the FSZ rectangle, with
// a fresnel + shimmer shader: nearly imperceptible head-on, glowing faintly at grazing
// angles, gently animated. Additive blend + no depth-write so it never occludes play.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { FSZ_MIN_X, FSZ_MAX_X, FSZ_MIN_Z, FSZ_MAX_Z } from '@/features/enemies/ai/fortressSafeZone';

const WALL_H = 400;            // effectively "infinite" — players never see the top
const HALF_H = WALL_H / 2;
const W_X = FSZ_MAX_X - FSZ_MIN_X; // 64 (front/back wall width)
const W_Z = FSZ_MAX_Z - FSZ_MIN_Z; // 96 (side wall width)
const CX = (FSZ_MIN_X + FSZ_MAX_X) / 2; // 0
const CZ = (FSZ_MIN_Z + FSZ_MAX_Z) / 2; // -16

const VERT = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  // Guard normalize(0): when the camera sits exactly on the wall plane, cameraPosition
  // - vWorldPos is the zero vector and normalize() returns NaN, which mipmapBlur bloom
  // then smears across the whole screen as a black flash.
  vec3 toCam = cameraPosition - vWorldPos;
  float toCamLen = max(length(toCam), 1e-4);
  vec3 viewDir = toCam / toCamLen;
  // Grazing angles glow; straight-on is nearly invisible (classic force-field).
  float fres = pow(1.0 - abs(dot(viewDir, vWorldNormal)), 3.0);
  // Gentle shimmer: vertical bands drifting up + a slow diagonal ripple.
  float bands  = sin(vWorldPos.y * 0.5 - uTime * 1.5) * 0.5 + 0.5;
  float ripple = sin(vWorldPos.x * 0.25 + vWorldPos.z * 0.25 + uTime * 1.7) * 0.5 + 0.5;
  float shimmer = mix(bands, ripple, 0.5);
  float alpha = 0.035 + fres * 0.32 + shimmer * fres * 0.22; // ~imperceptible flat-on
  vec3 col = uColor * (0.5 + shimmer * 0.8);
  gl_FragColor = vec4(col, alpha);
}`;

export function FortressForceField() {
  const uTime = useRef({ value: 0 });

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime.current,
      uColor: { value: new THREE.Color(0.45, 0.85, 1.0) }, // pale cyan
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }), []);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const unreg = frameLoop.register('fortress-forcefield', (_d, elapsed) => {
      uTime.current.value = elapsed;
    }, 66);
    return unreg;
  }, []);

  return (
    <group>
      {/* Front (z = FSZ_MAX_Z) and back (z = FSZ_MIN_Z): width spans X */}
      <mesh position={[CX, HALF_H, FSZ_MAX_Z]} material={material}>
        <planeGeometry args={[W_X, WALL_H]} />
      </mesh>
      <mesh position={[CX, HALF_H, FSZ_MIN_Z]} material={material}>
        <planeGeometry args={[W_X, WALL_H]} />
      </mesh>
      {/* Left (x = FSZ_MIN_X) and right (x = FSZ_MAX_X): rotated to span Z */}
      <mesh position={[FSZ_MIN_X, HALF_H, CZ]} rotation={[0, Math.PI / 2, 0]} material={material}>
        <planeGeometry args={[W_Z, WALL_H]} />
      </mesh>
      <mesh position={[FSZ_MAX_X, HALF_H, CZ]} rotation={[0, Math.PI / 2, 0]} material={material}>
        <planeGeometry args={[W_Z, WALL_H]} />
      </mesh>
    </group>
  );
}
