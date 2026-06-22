// SiegePortalEffect — an animated "portal to another universe" inside the lobby warp gate:
// swirling spirals + fractal tendrils + whirling, cycling colors with a bright pulsing core,
// masked to an oval so it reads as a magic gateway. Pure fragment-shader VFX on one plane —
// cheap (a single quad). Positioned to fill the meadow_SM_Bld_Warpgate_01 opening.
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Gate opening (meadow warpgate at (-91,24,301.5); opening faces +Z toward the lobby).
const PORTAL_POS: [number, number, number] = [-91, 28, 299.2]; // back another 30cm from spawn (−z)
const PORTAL_W = 4.6 * 0.8 * 1.15;   // +15% width so the oval reads round
const PORTAL_H = 6.0 * 0.8;

const FRAG = `
varying vec2 vUv;
uniform float uTime;
uniform float uDir;   // +1 / -1 → spiral handedness + spin direction
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v += a*noise(p); p*=2.0; a*=0.5; } return v; }
vec3 hue(float h){ return 0.5 + 0.5*cos(6.28318*(h + vec3(0.0, 0.33, 0.67))); }
void main(){
  vec2 uv = vUv * 2.0 - 1.0;            // -1..1, center origin
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  // spiral swirl — angle wound with radius, rotating over time. uDir flips handedness + spin.
  float swirl = (ang + r * 6.0) * uDir - uTime * 1.4 * uDir;
  float spiral = sin(swirl * 3.0) * 0.5 + 0.5;
  // fractal tendrils sampled in the swirled frame
  vec2 sp = vec2(cos(swirl), sin(swirl)) * r;
  float f = fbm(sp * 3.0 + uTime * 0.25);
  // whirling, cycling colors
  vec3 col = hue(ang / 6.28318 + r * 0.5 + uTime * 0.08);
  col = mix(col, hue(uTime * 0.13 + f), 0.5);
  col *= (0.55 + 0.75 * spiral) * (0.7 + 0.6 * f);
  // bright pulsing core sucked toward the center
  col += vec3(0.6, 0.75, 1.0) * smoothstep(0.6, 0.0, r) * (0.7 + 0.3 * sin(uTime * 3.0));
  // Brighten + keep a floor so it never reads as "just dark colors", and stays vivid against
  // the bright sky (normal-blended, so unlike additive it doesn't wash out over white).
  col = col * 1.7 + 0.06;
  // Mostly-opaque disc (so you can't see sky through it) with a quick soft fade only at the rim.
  float mask = smoothstep(1.0, 0.9, r);
  float alpha = max(mask * 0.92, mask * clamp(length(col) * 0.7, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}`;

const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function Spiral({ z, dir, speed }: { z: number; dir: number; speed: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDir: { value: dir } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [dir]);
  useFrame((_, dt) => { mat.uniforms.uTime.value += dt * speed; });
  return (
    <mesh position={[PORTAL_POS[0], PORTAL_POS[1], z]} material={mat}>
      <planeGeometry args={[PORTAL_W, PORTAL_H]} />
    </mesh>
  );
}

export function SiegePortalEffect() {
  // Two counter-rotating layers: the base swirl, and a reverse one spinning 50% faster, set 10cm
  // deeper into the gate (away from spawn).
  return (
    <>
      <Spiral z={PORTAL_POS[2]} dir={1} speed={1} />
      <Spiral z={PORTAL_POS[2] - 0.1} dir={-1} speed={1.5} />
    </>
  );
}
