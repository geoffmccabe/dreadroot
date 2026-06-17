// DarkLordFlame — a procedural GLSL fire shell that wraps a monster's body. Unlike the
// point-sprite flames (which read as rising bubbles), this is a tapered open cylinder whose
// fragment shader carves upward-licking, flickering flame tongues out of scrolling FBM noise,
// tapering to nothing at the top. Additive blending makes the tongues glow purple while the
// gaps stay transparent (reads as black-and-purple fire). Rendered as a CHILD of the monster
// group, so it follows the body for free — no per-frame position bookkeeping.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uDetail;     // horizontal tongue density
  uniform vec3 uColorHot;
  uniform vec3 uColorCool;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.0 + vec2(7.3, 3.1); a *= 0.5; }
    return v;
  }
  void main(){
    float t = uTime * uSpeed;
    float u = vUv.x, y = vUv.y;
    // upward-scrolling noise (two octaves) — vertical licks separated horizontally by uDetail
    float n1 = fbm(vec2(u * uDetail + sin(t * 0.5) * 0.25, y * 2.2 - t * 1.8));
    float n2 = fbm(vec2(u * uDetail * 2.3 + 19.0, y * 4.2 - t * 3.1));
    float flame = n1 * 0.62 + n2 * 0.38;
    // The threshold CLIMBS with height: at the base many tongues survive (but with gaps
    // between them), toward the top only the tallest licks remain → real flame tongues, not
    // a solid wall. This is what keeps the base from reading as a solid cone.
    float thresh = mix(0.42, 1.02, pow(y, 0.7));
    float a = smoothstep(thresh, thresh + 0.09, flame);
    if (a < 0.02) discard;
    vec3 col = mix(uColorCool, uColorHot, a);
    col *= (1.0 - y * 0.45);                      // darken toward the tips
    gl_FragColor = vec4(col, a * 0.85);
  }
`;

export function DarkLordFlame({ height, radius, colorHot = '#b85cff', colorCool = '#1a0033' }:
  { height: number; radius: number; colorHot?: string; colorCool?: string }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  // Open cylinder, only mildly tapered (a strong taper reads as a solid "cone of light").
  const geo = useMemo(
    () => new THREE.CylinderGeometry(radius * 0.75, radius * 1.1, height, 32, 1, true),
    [radius, height],
  );
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: 1.0 },
    uDetail: { value: 14.0 },   // more, thinner tongues = less solid
    uColorHot: { value: new THREE.Color(colorHot) },
    uColorCool: { value: new THREE.Color(colorCool) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  useFrame((_, dt) => { if (matRef.current) matRef.current.uniforms.uTime.value += Math.min(dt, 0.05); });
  return (
    <mesh geometry={geo} position={[0, height / 2, 0]} renderOrder={998} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
