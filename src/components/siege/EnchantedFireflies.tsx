// EnchantedFireflies — GPU firefly swarm. Renders every enabled FireflySpecies from the store as
// one additive THREE.Points; ALL per-firefly behaviour (drift, sine wobble, blink/pulse, fade,
// high-flyers, colour variance) runs in the vertex/fragment shader off a per-point attribute set +
// a single uTime uniform — so it's a handful of draw calls and stays cheap at high counts (the LOD
// answer). A distance cull fades out fireflies far from the camera. Driven live by the panel store.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FireflySpecies, useFireflyStore } from './fireflies/fireflySpecies';

const FUCHSIA = new THREE.Color('#ff3df0');
const BLUE = new THREE.Color('#3d6bff');
const CULL_DIST = 95; // m — fireflies beyond this fade out (LOD)

const VERT = /* glsl */ `
  uniform float uTime; uniform float uCull;
  attribute vec3 aColor;
  attribute vec4 aMot;    // phaseRad, speed, driftRadius, yAmp
  attribute vec4 aPulse;  // cyclePeriod, cyclePhase, onFrac, fadeSec
  attribute vec2 aFlags;  // sine(0/1), highFlyerYBoost(m, 0 = none)
  attribute float aSize;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float t = uTime;
    vec3 p = position;
    float ph = aMot.x, spd = aMot.y, dr = aMot.z, ya = aMot.w;
    p.x += sin(t * spd + ph) * dr;
    p.z += cos(t * spd * 0.8 + ph * 1.3) * dr;
    p.y += sin(t * spd * 0.6 + ph * 0.7) * ya;
    if (aFlags.x > 0.5) {                 // erratic sine sub-population
      p.x += sin(t * spd * 3.1 + ph) * 2.2;
      p.y += cos(t * spd * 2.4 + ph) * 1.6;
    }
    if (aFlags.y > 0.01) {                // high-flyers roam up into the trees
      p.y += abs(sin(t * spd * 0.4 + ph)) * aFlags.y;
    }
    // pulse / blink: trapezoid alpha over a per-point cycle (onFrac duty, fadeSec edges)
    float per = aPulse.x;
    float cph = fract((t + aPulse.y * per) / per);
    float onF = aPulse.z;
    float fadeFrac = clamp(aPulse.w / per, 0.0, 0.49);
    float a;
    if (fadeFrac < 0.002) { a = cph < onF ? 1.0 : 0.0; }
    else if (cph < fadeFrac) a = cph / fadeFrac;
    else if (cph < onF) a = 1.0;
    else if (cph < onF + fadeFrac) a = 1.0 - (cph - onF) / fadeFrac;
    else a = 0.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = length(mv.xyz);
    a *= smoothstep(uCull, uCull * 0.7, dist);   // LOD: fade out far away
    vColor = aColor; vAlpha = a;
    gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float glow = pow(smoothstep(0.5, 0.0, r), 1.5);
    gl_FragColor = vec4(vColor, glow * vAlpha);
  }
`;

function SpeciesPoints({ sp }: { sp: FireflySpecies }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const geom = useMemo(() => {
    const n = Math.max(0, Math.floor(sp.count));
    // seeded LCG so a species looks stable across reloads (seed from id chars)
    let s = 0; for (let i = 0; i < sp.id.length; i++) s = (s * 31 + sp.id.charCodeAt(i)) & 0x7fffffff;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const base = new THREE.Color(sp.baseColor);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const mot = new Float32Array(n * 4), pulse = new Float32Array(n * 4);
    const flags = new Float32Array(n * 2), size = new Float32Array(n);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const high = rnd() < sp.highFlyerPct;
      const yTop = sp.yMax + (high ? sp.highFlyerYBoost : 0);
      pos[i * 3] = (rnd() - 0.5) * 2 * sp.area;
      pos[i * 3 + 1] = sp.yMin + rnd() * (yTop - sp.yMin);
      pos[i * 3 + 2] = (rnd() - 0.5) * 2 * sp.area;
      // colour: 10% fully random, else base shifted toward fuchsia OR blue
      if (rnd() < sp.randomColorPct) tmp.setHSL(rnd(), 0.85, 0.6);
      else {
        tmp.copy(base);
        if (rnd() < 0.5) tmp.lerp(FUCHSIA, rnd() * sp.towardFuchsia);
        else tmp.lerp(BLUE, rnd() * sp.towardBlue);
      }
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      const spd = sp.speed * (1 + (rnd() * 2 - 1) * sp.speedVariancePct) * (high ? sp.highFlyerSpeedMul : 1);
      mot[i * 4] = rnd() * Math.PI * 2;
      mot[i * 4 + 1] = spd;
      mot[i * 4 + 2] = sp.driftRadius * (0.6 + rnd() * 0.8);
      mot[i * 4 + 3] = (0.6 + rnd() * 0.8) + (high ? 3 : 0);
      pulse[i * 4] = 2 + rnd() * 3;                 // cycle period 2–5s
      pulse[i * 4 + 1] = rnd();                       // phase offset
      pulse[i * 4 + 2] = sp.pulseOnFracMin + rnd() * (sp.pulseOnFracMax - sp.pulseOnFracMin);
      pulse[i * 4 + 3] = sp.fadeMinSec + rnd() * (sp.fadeMaxSec - sp.fadeMinSec);
      flags[i * 2] = rnd() < sp.sineWavePct ? 1 : 0;
      flags[i * 2 + 1] = high ? sp.highFlyerYBoost : 0;
      size[i] = sp.size * (0.8 + rnd() * 0.4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMot', new THREE.BufferAttribute(mot, 4));
    g.setAttribute('aPulse', new THREE.BufferAttribute(pulse, 4));
    g.setAttribute('aFlags', new THREE.BufferAttribute(flags, 2));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), sp.area * 2);
    return g;
  }, [sp]);

  // STABLE uniforms object (created once) so the drift animation never resets: an inline {uTime:{value:0}}
  // prop is a fresh object each render, and any re-render would reset uTime to 0 → fireflies freeze.
  const uniforms = useRef({ uTime: { value: 0 }, uCull: { value: CULL_DIST } }).current;
  useFrame((st) => { uniforms.uTime.value = st.clock.elapsedTime; });
  if (!sp.enabled || sp.count <= 0) return null;
  return (
    <points geometry={geom} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function EnchantedFireflies() {
  const species = useFireflyStore((s) => s.species);
  return <>{species.map((sp) => <SpeciesPoints key={sp.id} sp={sp} />)}</>;
}
