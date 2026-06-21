// Renders ONE authored light in the Canvas (preview now; monsters later). Local to its
// group — the parent positions/yaws it so the beam points along the group's -Z. Includes
// the spotlight (cookie + cheap shadow + cone + falloff), a glowing face disc (bright core
// + dark-grey rim), and a SOFT volumetric beam cone (fresnel-edged, blurry, fades out).
// Plan B: a real but low-res shadow, cheap, capped at deploy.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { cookieTexture, discTexture } from './lightCookie';
import { lightWave, type LightDef } from './lightTypes';

const DEG = Math.PI / 180;

// Soft volumetric beam: a fresnel-style glow on the cone shell so the silhouette is
// blurry (brightest where the surface is edge-on to the camera), fading out along the
// length. uAlong is 0 at the apex (near the light), 1 at the far base.
const BEAM_VERT = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vAlong;
uniform float uLen;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  // ConeGeometry local Y runs base(+h/2) .. apex(-h/2 after our flip); map to 0..1.
  vAlong = clamp(0.5 - position.y / uLen, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BEAM_FRAG = `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vAlong;
uniform vec3 uColor;
uniform float uStrength;
void main() {
  vec3 toCam = cameraPosition - vWorldPos;
  vec3 viewDir = toCam / max(length(toCam), 1e-4);
  // Soft edge glow, but with a base so the beam is NOT dark when viewed head-on (down
  // the axis). Pure fresnel went black face-on → a "dark circle" once the beam aims at
  // the viewer. Base 0.45 keeps the core glowing; fresnel adds soft brighter edges.
  float fres = pow(1.0 - abs(dot(viewDir, vWorldNormal)), 2.0);
  float glow = 0.45 + 0.55 * fres;
  // Brightest near the light, fading out toward the far end ("diminishes as it widens").
  float lenFade = 1.0 - vAlong;
  float a = uStrength * glow * (0.3 + 0.7 * lenFade);
  gl_FragColor = vec4(uColor, a);
}`;

export function GameLight({ def, idSuffix = '' }: { def: LightDef; idSuffix?: string }) {
  if (def.type === 'glow') return <GlowLight def={def} idSuffix={idSuffix} />;
  return <SpotLightImpl def={def} idSuffix={idSuffix} />;
}

// 'glow' type — an omni point light that washes nearby terrain (the Glow Block effect),
// plus a small glowing source sphere. Pulse + flicker drive the intensity over time.
function GlowLight({ def, idSuffix }: { def: LightDef; idSuffix: string }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const origin = useMemo(() => new THREE.Vector3(def.offX, def.offY, def.offZ), [def.offX, def.offY, def.offZ]);
  const baseI = def.intensity;

  useEffect(() => {
    const animated = def.flicker > 0 || def.pulseStyle !== 'none';
    if (!animated) { if (lightRef.current) lightRef.current.intensity = baseI; return; }
    const unreg = frameLoop.register(`glowlight-${def.code}-${idSuffix}`, (_d, t) => {
      if (lightRef.current) lightRef.current.intensity = baseI * lightWave(def, t);
    }, 64);
    return unreg;
  }, [def, idSuffix, baseI]);

  const sphereMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(def.emitterColor), toneMapped: false,
  }), [def.emitterColor]);
  useEffect(() => () => sphereMat.dispose(), [sphereMat]);

  return (
    <group>
      <pointLight
        ref={lightRef}
        position={[origin.x, origin.y, origin.z]}
        color={def.color}
        intensity={def.intensity}
        distance={def.range}
        decay={def.glowDecay}
        castShadow={false}
      />
      {def.emitterOn && (
        <mesh position={[origin.x, origin.y, origin.z]} material={sphereMat}>
          <sphereGeometry args={[Math.max(0.05, def.emitterSize * 0.5), 16, 12]} />
        </mesh>
      )}
    </group>
  );
}

function SpotLightImpl({ def, idSuffix = '' }: { def: LightDef; idSuffix?: string }) {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);

  const pitch = def.pitchDeg * DEG;
  const dir = useMemo(() => new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch)).normalize(), [pitch]);
  const origin = useMemo(() => new THREE.Vector3(def.offX, def.offY, def.offZ), [def.offX, def.offY, def.offZ]);
  const target = useMemo(() => origin.clone().addScaledVector(dir, def.range), [origin, dir, def.range]);

  const cookie = useMemo(() => cookieTexture(def.rimDarkness, def.rimSoftness), [def.rimDarkness, def.rimSoftness]);
  const disc = useMemo(() => discTexture(def.emitterColor), [def.emitterColor]);

  useEffect(() => {
    if (spotRef.current && targetRef.current) spotRef.current.target = targetRef.current;
  }, []);

  // Drive the spotlight intensity from pulse + flicker (no per-frame allocation).
  const baseI = def.intensity;
  useEffect(() => {
    const animated = def.flicker > 0 || def.pulseStyle !== 'none';
    if (!animated) { if (spotRef.current) spotRef.current.intensity = baseI; return; }
    const unreg = frameLoop.register(`gamelight-${def.code}-${idSuffix}`, (_d, t) => {
      if (spotRef.current) spotRef.current.intensity = baseI * lightWave(def, t);
    }, 64);
    return unreg;
  }, [def, idSuffix, baseI]);

  // --- Soft volumetric beam cone ---
  // Apex at the light (origin), base out along the beam — narrow at the light, widening
  // outward (the correct direction). Half-angle from the cone angle; long beam.
  const coneLen = Math.min(def.fogLength, def.range);
  const coneRad = Math.tan(Math.max(1, def.angleDeg) * 0.5 * DEG) * coneLen;
  const conePos = useMemo(() => origin.clone().addScaledVector(dir, coneLen * 0.5), [origin, dir, coneLen]);
  // ConeGeometry's apex is at +Y; rotate +Y → -dir so the apex sits on the light side.
  const coneQuat = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate()),
    [dir]
  );
  const beamMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(def.fogColor) },
      uStrength: { value: def.fogStrength },
      uLen: { value: coneLen },
    },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  }), [def.fogColor, def.fogStrength, coneLen]);
  useEffect(() => () => beamMat.dispose(), [beamMat]);

  // Face disc material (bright core + dark-grey rim). Basic so it always reads bright.
  const discMat = useMemo(() => new THREE.MeshBasicMaterial({
    map: disc, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    opacity: Math.min(1, 0.4 + def.emitterIntensity * 0.3),
  }), [disc, def.emitterIntensity]);
  useEffect(() => () => discMat.dispose(), [discMat]);
  // Disc faces along the beam (its +Z normal → dir), sat just in front of the light.
  const discQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir), [dir]);
  const discPos = useMemo(() => origin.clone().addScaledVector(dir, 0.08), [origin, dir]);

  return (
    <group>
      <spotLight
        ref={spotRef}
        position={[origin.x, origin.y, origin.z]}
        color={def.color}
        intensity={def.intensity}
        angle={Math.max(1, def.angleDeg) * 0.5 * DEG}
        penumbra={def.penumbra}
        distance={def.range}
        decay={def.decay}
        castShadow={def.shadowOn}
        shadow-mapSize-width={def.shadowSize}
        shadow-mapSize-height={def.shadowSize}
        shadow-camera-near={0.5}
        shadow-camera-far={def.range}
        // normalBias offsets the shadow along the surface normal — the proper cure for
        // blocky self-shadowing (acne) that was darkening the whole lit disc. bias kept
        // tiny. Together: the spotlight actually LIGHTS its area and occluders (trees,
        // blocks, monsters) cast clean shadows instead of the surface shadowing itself.
        shadow-normalBias={0.4}
        shadow-bias={-0.00015}
        map={cookie}
      />
      <object3D ref={targetRef} position={[target.x, target.y, target.z]} />

      {def.fogOn && coneLen > 0.1 && (
        <mesh position={[conePos.x, conePos.y, conePos.z]} quaternion={coneQuat} material={beamMat}>
          <coneGeometry args={[coneRad, coneLen, 28, 1, true]} />
        </mesh>
      )}

      {def.emitterOn && (
        <mesh position={[discPos.x, discPos.y, discPos.z]} quaternion={discQuat} material={discMat}>
          <circleGeometry args={[def.emitterSize * 0.5, 28]} />
        </mesh>
      )}
    </group>
  );
}
