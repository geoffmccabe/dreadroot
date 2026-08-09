// GlobeLighting — the Mini Earth's light, entirely driven by the Lightning Panel.
//
// Geoff: "give me the power to turn them on/off and adjust them, so they don't kill the game, and we
// can see which is doing what."
//
// WHY THIS SHAPE. The first attempt shipped six lighting changes in one commit — sun, shadows,
// terrain material, haze, clouds, grade — every one affecting the whole screen. When the screen came
// back white there were six suspects and no way to separate them, so I guessed, four times, wrongly,
// and it had to be reverted. Nothing here is hardcoded and nothing is on by default: every value is
// read live from globeLookStore, and with the master switch off this file renders exactly what the
// map rendered before any of it existed.
//
// WHAT WAS ACTUALLY WRONG WITH THE LIGHTING, all of which is now a control rather than a decision:
//
// 1. THE GLOBE IS LIT AS A "BLANK" MAP. SiegeWorldLayers adds a bright fill for builder maps on top
//    of the world's own ambient and hemisphere — over 1.0 of directionless light in total.
//    Directionless light cannot make a bright side and a dark side, so nothing has form. That is
//    what "washed out" means, and it is the Fill sliders.
//
// 2. THE SUN IS A FIXED WORLD VECTOR. `[400, 600, 300]` was chosen for a flat map a few thousand
//    units across; this planet's radius is 63,710, and three.js uses only a directional light's
//    DIRECTION. So it is a fixed compass heading: overhead at one point on Earth, on the horizon a
//    quarter of the way round, underneath you on the far side. The sun here is computed from where
//    you are STANDING instead.
//
// 3. SHADOWS ARE OFF. Not dialled down — off at the renderer (a global default bound to '-') and
//    additionally disabled mesh by mesh on every Kaiju. A 300 m creature with no shadow cannot sit
//    in a scene.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { body as playerBody } from './kaijuBody';
import { globeLook, useGlobeLook } from '@/features/look/globeLookStore';
import { lookStore } from '@/features/look/lookStore';

/**
 * The current sun direction, in world space.
 *
 * Shared rather than recomputed, because the clouds have to be lit by the SAME sun as the ground and
 * two independent copies of "where is the sun" ends with a lit cloud deck over a shadowed terrain.
 */
export const sunDirection = new THREE.Vector3(0, 1, 0);

/** Warm end of the sun ramp. A low sun IS orange: the blue has been scattered out of it. */
const SUN_WARM = new THREE.Color(0xffc98a);
const SUN_COOL = new THREE.Color(0xfff6ec);
/** The shadow side of anything outdoors is lit by the sky, which is why it reads blue. */
const SKY_COLOUR = 0x9fc4ff;
const GROUND_BOUNCE = 0x6b5a48;

const SHADOW_MAP_SIZE = 2048;

/**
 * A tangent vector pointing along a compass bearing at `dir`. 0 = north, 90 = east.
 *
 * On a sphere there is no global "north-east"; there is only north-east AT A PLACE. Same function
 * the arena uses to face a Kaiju at the view when it arrives somewhere.
 */
function bearingTangent(dir: THREE.Vector3, degrees: number, out: THREE.Vector3): THREE.Vector3 {
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
  if (east.lengthSq() < 1e-9) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(dir, east).normalize();
  const r = (degrees * Math.PI) / 180;
  return out.copy(north).multiplyScalar(Math.cos(r)).addScaledVector(east, Math.sin(r)).normalize();
}

export function GlobeLighting() {
  const look = useGlobeLook();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const setDpr = useThree((s) => s.setDpr);
  const sun = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => ({
    up: new THREE.Vector3(), bearing: new THREE.Vector3(), toSun: new THREE.Vector3(),
    focus: new THREE.Vector3(),
  }), []);
  const sunColour = useMemo(() => new THREE.Color(), []);

  const on = look.enabled;

  /**
   * SHADOWS, and restoring whatever was there before.
   *
   * The Canvas is created with `shadows={shadowsEnabled}`, a global toggle defaulting OFF for cost
   * and bound to the '-' key. Sensible for a voxel world of hundreds of blocks; wrong for a scene
   * whose whole subject is four 300 m creatures. Switched on here only while this map wants it, so
   * no other map inherits the cost.
   */
  useEffect(() => {
    if (!on || !look.shadowsOn) return;
    const hadEnabled = gl.shadowMap.enabled;
    const hadType = gl.shadowMap.type;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = look.shadowSoft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    gl.shadowMap.needsUpdate = true;
    // EVERY MATERIAL MUST BE RECOMPILED, and this is the other half of "shadows don't work".
    //
    // Whether a material samples the shadow map is baked into its SHADER at compile time, from the
    // renderer's settings when that shader was first built. Flipping gl.shadowMap.enabled afterwards
    // changes nothing for anything already on screen: the terrain, the Kaiju and the crowd carry on
    // running the shader they were compiled with, which has no shadow code in it at all.
    // `needsUpdate` forces the rebuild. It is a visible hitch, which is why it is done once on the
    // switch rather than every frame.
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; });
      else m.needsUpdate = true;
    });
    return () => {
      gl.shadowMap.enabled = hadEnabled;
      gl.shadowMap.type = hadType;
      gl.shadowMap.needsUpdate = true;
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; });
        else m.needsUpdate = true;
      });
    };
  }, [gl, scene, on, look.shadowsOn, look.shadowSoft]);

  /** Render resolution. See the note on `dpr` in the store for why this is the sharpness lever. */
  useEffect(() => {
    if (!on || look.dpr <= 1) return;
    const had = gl.getPixelRatio();
    // Never ask for more than the display has: on a 1x screen that is pure waste.
    setDpr(Math.min(look.dpr, typeof window !== 'undefined' ? window.devicePixelRatio : 1));
    return () => setDpr(had);
  }, [gl, setDpr, on, look.dpr]);

  /**
   * EXPOSURE, pushed into the shared look store so LookSync applies it.
   *
   * Restored on the way out, or leaving the map would leave every other one graded for open
   * landscape under a low sun.
   */
  useEffect(() => {
    if (!on || !look.gradeOn) return;
    const had = lookStore.get().exposure;
    lookStore.set('exposure', look.exposure);
    return () => { lookStore.set('exposure', had); };
  }, [on, look.gradeOn, look.exposure]);

  useFrame(() => {
    const s = sun.current;
    const g = globeLook();
    if (!s || !g.enabled || !g.sunOn) return;

    // THE SUN IS RELATIVE TO WHERE YOU STAND. Local up at the player, a compass bearing in that
    // place's own tangent plane, then tilted up by the elevation. That is a sun which sits at the
    // same angle in the sky wherever on the planet you are — which is what a sun is, and what a
    // fixed world vector can never be.
    scratch.up.copy(playerBody.dir).normalize();
    bearingTangent(scratch.up, g.sunBearing, scratch.bearing);
    const el = (g.sunElevation * Math.PI) / 180;
    scratch.toSun.copy(scratch.bearing).multiplyScalar(Math.cos(el))
      .addScaledVector(scratch.up, Math.sin(el)).normalize();
    sunDirection.copy(scratch.toSun);

    // FOLLOW THE PLAYER. The shadow camera covers a few km; the planet is 40,000 km around. Without
    // this, shadows would exist in exactly one place on Earth.
    scratch.focus.copy(playerBody.dir).multiplyScalar(playerBody.radius);
    target.position.copy(scratch.focus);
    target.updateMatrixWorld();
    s.position.copy(scratch.focus).addScaledVector(scratch.toSun, g.shadowSpanM / METRES_PER_UNIT);
    s.updateMatrixWorld();

    // Live from the panel, so intensity and warmth can be dialled while watching them.
    s.intensity = g.sunIntensity;
    s.color.copy(sunColour.copy(SUN_COOL).lerp(SUN_WARM, g.sunWarmth));
  });

  // MASTER OFF = exactly what the map did before any of this. Not an approximation of it: the same
  // blank-map fill SiegeWorldLayers would have added, which is now suppressed there so this file is
  // the only thing lighting the globe either way.
  if (!on) {
    return (
      <>
        <ambientLight intensity={0.7} />
        <hemisphereLight args={['#ffffff', '#b9c4d0', 0.6]} />
      </>
    );
  }

  const half = look.shadowSpanM / METRES_PER_UNIT / 2;

  return (
    <>
      {/* The old flat fill, kept as sliders rather than deleted — so the difference between "washed
          out" and "lit" can be seen by dragging one control instead of being argued about. */}
      {look.fillAmbient > 0 && <ambientLight intensity={look.fillAmbient} />}
      {look.fillHemi > 0 && (
        <hemisphereLight args={[SKY_COLOUR, GROUND_BOUNCE, look.fillHemi]} />
      )}

      {look.sunOn && (
        <>
          <directionalLight
            ref={sun}
            castShadow={look.shadowsOn}
            shadow-mapSize-width={SHADOW_MAP_SIZE}
            shadow-mapSize-height={SHADOW_MAP_SIZE}
            shadow-camera-left={-half}
            shadow-camera-right={half}
            shadow-camera-top={half}
            shadow-camera-bottom={-half}
            shadow-camera-near={0.1}
            shadow-camera-far={(look.shadowSpanM * 2.5) / METRES_PER_UNIT}
            /*
              BIAS. Shadow acne over a planet-scale depth range is a certainty without it, and
              normalBias is the one to lean on: it offsets along the surface normal, so it cures
              self-shadowing on terrain without detaching a Kaiju's shadow from its feet — which is
              what a large plain bias does, and is the "floating character" look.
            */
            shadow-bias={-0.0004}
            shadow-normalBias={0.04}
            target={target}
          />
          <primitive object={target} />
        </>
      )}

      {/* Sky bounce. Not fill: this is the sky above and the ground below, which is physically what
          lights the shadow side of anything outdoors, and it keeps that side blue rather than black
          without flattening the form the sun just created. */}
      {look.skyBounce > 0 && (
        <hemisphereLight args={[SKY_COLOUR, GROUND_BOUNCE, look.skyBounce]} />
      )}
    </>
  );
}
