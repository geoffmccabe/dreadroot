// BleakrockLighting — proximity-driven horror atmosphere for the Bleakrock (mushroom) island.
// Self-contained: it only ever touches scene.fog (snapshotting + restoring whatever was there
// before) and draws its own camera-facing screen shader, so it never fights the shared DreadRoot
// day/night lighting and leaves the rest of the world untouched.
//
// Two layers, both ramped by how close the player is to Bleakrock:
//   1. Close, cold, dark Silent-Hill fog (scene.fog) — distance dissolves into the dark.
//   2. A full-screen SHADER scrim: a vignette that closes in, drifting dread-fog tendrils,
//      a slow dread "breath" pulse, and film grain — so it reads as a whole-screen horror
//      effect, not just a flat dim.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const CENTER = new THREE.Vector3(-1039, 24, 1108);   // Bleakrock centroid (teleport slot 3)
const RADIUS = 300;                                  // full horror within this many metres
const FADE = 160;                                    // blends in/out across this band beyond it
const FOG_COLOR = 0x0a1512;                          // near-black sickly teal

const SCRIM_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uIntensity;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p = p * 2.0 + 1.7; a *= 0.5; } return v; }

  void main(){
    vec2 uv = vUv;
    float d = length(uv - 0.5);
    float pulse = 0.55 + 0.45 * sin(uTime * 0.7);                 // slow dread "breath"
    float vig = smoothstep(0.28, 0.92, d);                       // dark closing in from the edges
    // drifting fog tendrils
    float fog = fbm(uv * 3.0 + vec2(uTime * 0.05, uTime * 0.12));
    fog *= fbm(uv * 6.0 - vec2(uTime * 0.08, uTime * 0.03));
    float grain = hash(uv * vec2(800.0, 600.0) + fract(uTime)) * 0.07;
    vec3 col = mix(vec3(0.015, 0.05, 0.04), vec3(0.05, 0.02, 0.06), fog);   // sickly teal → bruise purple
    float a = (vig * 0.72 + fog * 0.35 * (0.55 + 0.45 * pulse) + grain) * uIntensity;
    a = clamp(a, 0.0, 0.93);
    gl_FragColor = vec4(col, a);
  }
`;

const SCRIM_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export function BleakrockLighting() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const owning = useRef(false);
  const savedFog = useRef<THREE.FogBase | null>(null);
  const horrorFog = useMemo(() => new THREE.Fog(FOG_COLOR, 12, 200), []);
  const _dir = useMemo(() => new THREE.Vector3(), []);

  const scrim = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SCRIM_VERT,
      fragmentShader: SCRIM_FRAG,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), mat);
    m.renderOrder = 997;
    m.frustumCulled = false;
    return m;
  }, []);

  useEffect(() => () => {                              // restore fog on unmount
    if (owning.current) scene.fog = savedFog.current;
  }, [scene]);

  useFrame((_, dt) => {
    const dx = camera.position.x - CENTER.x, dz = camera.position.z - CENTER.z;
    const dist = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, (RADIUS + FADE - dist) / FADE));

    const mat = scrim.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value += Math.min(dt, 0.05);
    mat.uniforms.uIntensity.value = t;
    camera.getWorldDirection(_dir);                   // keep the scrim pinned in front of the camera
    scrim.position.copy(camera.position).addScaledVector(_dir, 0.6);
    scrim.quaternion.copy(camera.quaternion);

    if (t > 0.001) {
      if (!owning.current) { owning.current = true; savedFog.current = scene.fog; }
      horrorFog.near = THREE.MathUtils.lerp(900, 14, t);
      horrorFog.far = THREE.MathUtils.lerp(4000, 135, t);
      scene.fog = horrorFog;
    } else if (owning.current) {
      owning.current = false; scene.fog = savedFog.current;
    }
  });

  return <primitive object={scrim} />;
}
