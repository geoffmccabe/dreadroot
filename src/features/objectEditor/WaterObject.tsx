// A placed "water" object: a flat surface with a stylized-but-rich look that stays cheap (no render
// passes, safe on phones). All the sophistication is in ONE custom shader:
//   • layered directional waves → an analytic ripple normal (far richer than a single sin)
//   • FRESNEL fake reflection — grazing angles reflect a procedural sky gradient, top-down shows the
//     water tint (this "cheap reflection" reads as real water with zero extra textures/passes)
//   • a sharp animated sun glint that sparkles off the wave normals
// No emissive glow (the old surface was a flat over-bright teal). It's a normal placed object: moves/
// rotates/scales with the Arrange tools and shares via world_objects. Spawn with ^wa; flood with ^wf/F.
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldObject } from './types';
import { buildFloodGeometry } from './floodMesh';

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime, uOpacity, uReflect;
  uniform vec3 uDeep, uShallow, uSkyHorizon, uSkyZenith, uSunColor, uSunDir;
  varying vec3 vWorldPos;

  void main() {
    vec2 p = vWorldPos.xz;
    float t = uTime;
    // Three directional waves (+ one fine ripple). We only need the SLOPE for the normal, so use the
    // analytic derivative of each sine — cheap and exact, no texture fetches.
    vec2 d1 = normalize(vec2( 1.0,  0.35)); float f1 = 0.33, s1 = 1.05, a1 = 0.22;
    vec2 d2 = normalize(vec2(-0.6,  1.0 )); float f2 = 0.61, s2 = 1.55, a2 = 0.13;
    vec2 d3 = normalize(vec2( 0.45,-0.85)); float f3 = 1.15, s3 = 2.10, a3 = 0.07;
    vec2 d4 = normalize(vec2(-0.9, -0.3 )); float f4 = 2.4,  s4 = 3.30, a4 = 0.03;
    float c1 = cos(dot(p, d1) * f1 + t * s1) * a1 * f1;
    float c2 = cos(dot(p, d2) * f2 + t * s2) * a2 * f2;
    float c3 = cos(dot(p, d3) * f3 + t * s3) * a3 * f3;
    float c4 = cos(dot(p, d4) * f4 + t * s4) * a4 * f4;
    float dHdx = c1 * d1.x + c2 * d2.x + c3 * d3.x + c4 * d4.x;
    float dHdz = c1 * d1.y + c2 * d2.y + c3 * d3.y + c4 * d4.y;
    vec3 N = normalize(vec3(-dHdx, 1.0, -dHdz));
    vec3 V = normalize(cameraPosition - vWorldPos);

    // Fresnel: reflective at grazing angles, transparent tint looking straight down.
    float fres = uReflect + (1.0 - uReflect) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    fres = clamp(fres, 0.0, 1.0);

    // Procedural sky reflection (no cubemap): blend horizon→zenith by the reflected ray's height.
    vec3 R = reflect(-V, N);
    vec3 skyCol = mix(uSkyHorizon, uSkyZenith, clamp(R.y * 0.5 + 0.5, 0.0, 1.0));
    float sun = pow(max(dot(R, normalize(uSunDir)), 0.0), 140.0);   // tight, sparkly sun glint

    vec3 water = mix(uShallow, uDeep, max(dot(N, V), 0.0));          // deeper straight down
    vec3 col = mix(water, skyCol, fres) + uSunColor * sun;
    float alpha = mix(uOpacity, 1.0, fres);                          // edges/glints read more solid
    gl_FragColor = vec4(col, alpha);
  }
`;

export function WaterObject({ obj }: { obj: WorldObject }) {
  const { mat, uniforms } = useMemo(() => {
    const uniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0.72 },
      uReflect: { value: 0.06 },
      uDeep: { value: new THREE.Color('#0e2a38') },
      uShallow: { value: new THREE.Color('#1f6b86') },
      uSkyHorizon: { value: new THREE.Color('#9fb6c6') },
      uSkyZenith: { value: new THREE.Color('#41648c') },
      uSunColor: { value: new THREE.Color('#ffe6bd') },
      uSunDir: { value: new THREE.Vector3(0.5, 0.72, 0.4).normalize() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    return { mat, uniforms };
  }, []);
  useFrame((_, dt) => { uniforms.uTime.value += dt; });
  useEffect(() => () => mat.dispose(), [mat]);

  // A flooded pool: the surface is the baked shore-seeking footprint (world XZ, built at y=0). It
  // renders at the object's live height (obj.pos[1]) so wheeling raises/lowers the whole surface you
  // see, and re-flooding snaps the shoreline to that level. The XZ footprint stays world-anchored.
  const floodGeo = useMemo(() => (obj.flood ? buildFloodGeometry(obj.flood) : null), [obj.flood]);
  useEffect(() => () => floodGeo?.dispose(), [floodGeo]);
  if (floodGeo) {
    return <mesh geometry={floodGeo} material={mat} position={[0, obj.pos[1], 0]} userData={{ worldObjectId: obj.id }} />;
  }
  // Not yet flooded: the movable 1×1 preview plane, laid flat (normal up); pos/quat/scale from the editor.
  return (
    <group position={obj.pos} quaternion={obj.quat} scale={obj.scale} userData={{ worldObjectId: obj.id }}>
      <mesh rotation-x={-Math.PI / 2} material={mat} userData={{ worldObjectId: obj.id }}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
