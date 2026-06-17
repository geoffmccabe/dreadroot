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
    // two scrolling-up noise layers = licking flames; slight sideways drift for flicker
    float n1 = fbm(vec2(u * uDetail + sin(t * 0.6) * 0.3, y * 3.0 - t * 1.6));
    float n2 = fbm(vec2(u * uDetail * 2.0 + 11.0, y * 5.0 - t * 2.7));
    float flame = mix(n1, n2, 0.4);
    float fall = pow(1.0 - y, 1.4);              // full at the feet, gone by the top
    float a = flame * fall * 1.9 - (1.0 - fall) * 0.35;
    a = smoothstep(0.22, 0.8, a);                // carve into sharp tongues
    if (a < 0.02) discard;
    vec3 col = mix(uColorCool, uColorHot, a);
    col += uColorHot * (1.0 - y) * 0.25;         // brighter core near the base
    gl_FragColor = vec4(col, a);
  }
`;

export function DarkLordFlame({ height, radius }: { height: number; radius: number }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  // Tapered open cylinder: a touch wider at the feet, narrowing as it rises.
  const geo = useMemo(
    () => new THREE.CylinderGeometry(radius * 0.45, radius * 1.15, height, 28, 1, true),
    [radius, height],
  );
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: 1.0 },
    uDetail: { value: 9.0 },
    uColorHot: { value: new THREE.Color('#b85cff') },   // bright purple
    uColorCool: { value: new THREE.Color('#1a0033') },  // near-black violet
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
