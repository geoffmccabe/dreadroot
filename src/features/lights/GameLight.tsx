// Renders ONE authored light in the Canvas (preview now; monsters later). Local to its
// group — the parent positions/yaws it (e.g. on a Shombie's face). Includes the spotlight
// (cookie + cheap shadow + 22° cone + 24m falloff), the glowing face disc, and an additive
// fog cone (the visible beam). Plan B: a real but low-res shadow, cheap, capped at deploy.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { applyGlow } from '@/lib/glow';
import { cookieTexture } from './lightCookie';
import type { LightDef } from './lightTypes';

const DEG = Math.PI / 180;

export function GameLight({ def, idSuffix = '' }: { def: LightDef; idSuffix?: string }) {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const emitterMatRef = useRef<THREE.MeshStandardMaterial>(null);

  // Aim direction (forward -z, tilted down by pitch) and the target point.
  const pitch = def.pitchDeg * DEG;
  const dir = useMemo(() => new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch)).normalize(), [pitch]);
  const origin = useMemo(() => new THREE.Vector3(def.offX, def.offY, def.offZ), [def.offX, def.offY, def.offZ]);
  const target = useMemo(() => origin.clone().addScaledVector(dir, def.range), [origin, dir, def.range]);

  const cookie = useMemo(() => cookieTexture(def.rimDarkness, def.rimSoftness), [def.rimDarkness, def.rimSoftness]);

  // Wire the spotlight to its target object.
  useEffect(() => {
    if (spotRef.current && targetRef.current) spotRef.current.target = targetRef.current;
  }, []);

  // Flicker the spotlight + emitter together.
  const baseI = def.intensity;
  const emitI = def.emitterIntensity;
  const flick = def.flicker;
  useEffect(() => {
    if (flick <= 0) return;
    const unreg = frameLoop.register(`gamelight-${def.code}-${idSuffix}`, (_d, t) => {
      const f = 1 - flick + flick * Math.sin(t * 11) * Math.sin(t * 6.7 + 1.3);
      if (spotRef.current) spotRef.current.intensity = baseI * f;
      if (emitterMatRef.current) emitterMatRef.current.emissiveIntensity = emitI * f;
    }, 64);
    return unreg;
  }, [def.code, flick, baseI, emitI]);

  // Fog cone geometry (apex at origin, opening toward the target).
  const coneLen = Math.min(def.fogLength, def.range);
  const coneRad = Math.tan((def.angleDeg * 0.5) * DEG) * coneLen;
  const coneQuat = useMemo(() => {
    // ConeGeometry points along +Y; rotate +Y to the beam direction.
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [dir]);
  const conePos = useMemo(() => origin.clone().addScaledVector(dir, coneLen * 0.5), [origin, dir, coneLen]);
  const fogMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(def.fogColor), transparent: true, opacity: def.fogStrength,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }), [def.fogColor, def.fogStrength]);
  useEffect(() => () => fogMat.dispose(), [fogMat]);

  // Emitter disc material (glows). emitterIntensity is NOT a dep — it's driven each
  // frame by the flicker loop (or set in the effect below), so changing it must not
  // rebuild the material (that would force a shader recompile / hitch).
  const emitterMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.emitterColor) });
    applyGlow(m, { color: def.emitterColor, intensity: emitI });
    return m;
  }, [def.emitterColor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { emitterMatRef.current = emitterMat; return () => emitterMat.dispose(); }, [emitterMat]);
  // Apply intensity changes in-place (no recompile) when not flickering.
  useEffect(() => { if (flick <= 0 && emitterMatRef.current) emitterMatRef.current.emissiveIntensity = emitI; }, [emitI, flick]);
  // Emitter disc faces along the beam.
  const discQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir), [dir]);

  return (
    <group>
      <spotLight
        ref={spotRef}
        position={[origin.x, origin.y, origin.z]}
        color={def.color}
        intensity={def.intensity}
        angle={(def.angleDeg * 0.5) * DEG}
        penumbra={def.penumbra}
        distance={def.range}
        decay={def.decay}
        castShadow={def.shadowOn}
        shadow-mapSize-width={def.shadowSize}
        shadow-mapSize-height={def.shadowSize}
        shadow-camera-near={0.3}
        shadow-camera-far={def.range}
        shadow-bias={-0.0009}
        map={cookie}
      />
      <object3D ref={targetRef} position={[target.x, target.y, target.z]} />

      {def.fogOn && coneLen > 0.1 && (
        <mesh position={[conePos.x, conePos.y, conePos.z]} quaternion={coneQuat} material={fogMat}>
          <coneGeometry args={[coneRad, coneLen, 24, 1, true]} />
        </mesh>
      )}

      {def.emitterOn && (
        <mesh position={[origin.x, origin.y, origin.z]} quaternion={discQuat} material={emitterMat}>
          <circleGeometry args={[def.emitterSize * 0.5, 24]} />
        </mesh>
      )}
    </group>
  );
}
