// GlobeLighting — a real sun, real shadows, and an end to the flat white fill.
//
// Geoff: "everything looks soft and washed out. The Kaiju look like cartoons with no shadows, very
// poor lighting."
//
// THREE THINGS WERE WRONG, and only one of them was a lighting VALUE.
//
// 1. THE GLOBE WAS BEING LIT AS A "BLANK" MAP. SiegeWorldLayers classes anything that is not the
//    hand-built SWW world as blank and adds a bright fill so object textures read clearly — on top
//    of the shared world's own ambient and hemisphere. That stacked up to roughly 1.05 of ambient
//    plus TWO hemisphere lights. Directionless light is exactly what "washed out" means: it is
//    light that cannot produce a bright side and a dark side, so nothing has form.
//
// 2. THE SUN WAS A FIXED WORLD VECTOR. `directionalLight position={[400, 600, 300]}` is 700 units
//    from the origin, chosen for a flat map a few thousand units across. This planet has a radius
//    of 63,710. three.js only uses a directional light's DIRECTION, so that vector is a fixed
//    compass heading in world space — which on a sphere means the sun is overhead at one point,
//    on the horizon a quarter of the way round, and UNDERNEATH YOU on the far side. Wherever you
//    land, the sun angle is arbitrary.
//
// 3. SHADOWS WERE OFF EVERYWHERE. Not dialled down: switched off at the renderer, and every Kaiju
//    additionally sets castShadow = false on every mesh. A 300 m creature with no shadow cannot sit
//    in a scene, and that is the whole of "they look like cartoons".
//
// So this owns the light for the Mini Earth: one sun with a real elevation and bearing relative to
// where you are STANDING, a shadow camera that follows you, and just enough sky bounce to keep the
// shadow side from going black.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { body as playerBody } from './kaijuBody';
import { setCinematicGrade } from '@/features/look/cinematicGrade';
import { lookStore } from '@/features/look/lookStore';
import { LOOK } from '@/features/look/lookConfig';

/**
 * Sun elevation above the local horizon, in degrees.
 *
 * 14 is golden hour, and it is the single biggest lever on this whole job. A high sun puts light
 * straight down: short shadows, flat cliff faces, no modelling. A low sun rakes ACROSS the terrain,
 * so every ridge throws a long shadow and the canyon walls separate into lit and unlit planes. It
 * is why landscape photographers only work at either end of the day.
 */
export const SUN_ELEVATION_DEG = 14;
/** Compass bearing the sun sits at, 0 = north. Chosen so the Grand Canyon's north rim is lit. */
export const SUN_BEARING_DEG = 205;

/** Warm, because a low sun IS warm — the blue has been scattered out of it by the atmosphere. */
const SUN_COLOUR = 0xffd9a8;
/** Cool, because the shadow side of anything outdoors is lit by the sky, which is blue. */
const SKY_COLOUR = 0x9fc4ff;
const GROUND_BOUNCE = 0x6b5a48;

/**
 * How wide the shadow map covers, in metres.
 *
 * A shadow camera has to enclose everything that casts, and its resolution is spread over whatever
 * area it covers — so this is a straight trade between how far away shadows exist and how crisp
 * they are. 3 km at 2048 pixels is about 1.5 m per shadow texel, which on a creature 300 m tall is
 * a clean edge, and it comfortably holds four Kaiju and the crowd around them.
 *
 * It CANNOT be the planet. A shadow camera covering 40,000 km would give one texel per 20 km.
 */
const SHADOW_SPAN_M = 3000;
const SHADOW_MAP_SIZE = 2048;

/**
 * A tangent vector pointing along a compass bearing at `dir`. 0 = north, 90 = east.
 *
 * Same function the arena uses to face a Kaiju at a view on arrival. On a sphere there is no global
 * "north-east"; there is only north-east AT A PLACE, which is what this computes.
 */
function bearingTangent(dir: THREE.Vector3, degrees: number, out: THREE.Vector3): THREE.Vector3 {
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
  if (east.lengthSq() < 1e-9) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(dir, east).normalize();
  const r = (degrees * Math.PI) / 180;
  return out.copy(north).multiplyScalar(Math.cos(r)).addScaledVector(east, Math.sin(r)).normalize();
}

/**
 * Render resolution while the Mini Earth is on screen.
 *
 * THIS IS WHY EVERYTHING LOOKED SOFT, and it is not a lighting problem at all. The Canvas is created
 * with `dpr={1}` and `antialias: false`, so on a Retina display the game draws at HALF the screen's
 * resolution and the browser stretches it up. That is a blur filter over the entire image before any
 * material or light gets a say — and it is also why edges read as mushy rather than jagged.
 *
 * 1.5 rather than full native: full costs four times the pixels, 1.5 costs 2.25 and recovers most of
 * the sharpness. Raised only for this map and restored on the way out, because every other map made
 * its own performance bargain at 1 and it is not this file's place to overrule it.
 */
const GLOBE_DPR = 1.5;

/**
 * The current sun direction, in world space.
 *
 * Shared rather than recomputed: the clouds have to be lit by the SAME sun as the ground, and two
 * independent copies of "where is the sun" is the kind of duplication that ends with a lit cloud
 * deck over a terrain in shadow.
 */
export const sunDirection = new THREE.Vector3(0, 1, 0);

/**
 * ONE KEY THAT BISECTS THIS, because three broken builds in a row is three too many.
 *
 * Shift+L switches the whole new look off and puts the old lights back. I cannot see the screen, and
 * every diagnosis so far has been me reasoning from a description — which has been wrong more often
 * than right. This turns the next report from "still white" into an answer:
 *
 *   WHITE GOES AWAY with the old lights  -> the cause is the lights, the grade or the exposure
 *   STILL WHITE with the old lights      -> the cause is the terrain material, which stays either
 *                                           way, or something not in this file at all
 *
 * Those need completely different fixes, and one keypress separates them.
 */
let newLook = true;
const lookListeners = new Set<() => void>();
function setNewLook(v: boolean): void {
  newLook = v;
  for (const l of lookListeners) l();
  console.log(`[globe] lighting: ${v ? 'NEW (sun + shadows + grade)' : 'OLD (flat fill)'}`);
}

export function GlobeLighting() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    lookListeners.add(fn);
    const key = (e: KeyboardEvent) => {
      if (e.code === 'KeyL' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        setNewLook(!newLook);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { lookListeners.delete(fn); window.removeEventListener('keydown', key, true); };
  }, []);

  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const sun = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => ({
    up: new THREE.Vector3(), bearing: new THREE.Vector3(), toSun: new THREE.Vector3(),
    focus: new THREE.Vector3(),
  }), []);

  /**
   * TURN THE SHADOW MAP ON, and put it back afterwards.
   *
   * The Canvas is created with `shadows={shadowsEnabled}`, a global toggle that defaults OFF for
   * cost and is bound to the '-' key. That is a reasonable default for a voxel world with hundreds
   * of blocks; it is the wrong default for a scene whose entire subject is four 300 m creatures.
   * Rather than change the global (which would light up every other map's cost), the Mini Earth
   * switches it on while it is mounted and restores whatever it found on the way out.
   */
  /**
   * THE GRADE AND THE AO, for as long as this map is on screen.
   *
   * Exposure comes down from the 1.1 default because the scene no longer needs lifting: it has a
   * real key light now, so the job changes from "make it visible" to "give the highlights somewhere
   * to go". Restored on the way out so no other map inherits a curve tuned for open landscape.
   */
  useEffect(() => {
    if (!newLook) return;
    const hadExposure = lookStore.get().exposure;
    setCinematicGrade(true);
    lookStore.set('exposure', LOOK.grade.exposure);
    return () => {
      setCinematicGrade(false);
      lookStore.set('exposure', hadExposure);
    };
  }, [newLook]);

  useEffect(() => {
    if (!newLook) return;
    const had = gl.getPixelRatio();
    // Never ask for more than the display actually has: on a 1x screen that would be pure waste.
    setDpr(Math.min(GLOBE_DPR, typeof window !== 'undefined' ? window.devicePixelRatio : 1));
    return () => setDpr(had);
  }, [gl, setDpr, newLook]);

  useEffect(() => {
    if (!newLook) return;
    const hadShadows = gl.shadowMap.enabled;
    const hadType = gl.shadowMap.type;
    gl.shadowMap.enabled = true;
    // PCF SOFT, not basic. A hard shadow edge on something this size reads as a decal; the soft
    // variant costs a handful of extra taps and is the difference between a shadow and a stain.
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.enabled = hadShadows;
      gl.shadowMap.type = hadType;
      gl.shadowMap.needsUpdate = true;
    };
  }, [gl, newLook]);

  useFrame(() => {
    const s = sun.current;
    if (!s || !newLook) return;

    // THE SUN IS RELATIVE TO WHERE YOU STAND. Local up at the player, then a compass bearing in
    // that place's own tangent plane, then tilt up by the elevation. That gives a sun which is
    // always at the same angle in the sky wherever on the planet you are — which is what a sun is,
    // and what a fixed world vector can never be.
    scratch.up.copy(playerBody.dir).normalize();
    bearingTangent(scratch.up, SUN_BEARING_DEG, scratch.bearing);
    const el = (SUN_ELEVATION_DEG * Math.PI) / 180;
    scratch.toSun.copy(scratch.bearing).multiplyScalar(Math.cos(el))
      .addScaledVector(scratch.up, Math.sin(el)).normalize();
    sunDirection.copy(scratch.toSun);

    // FOLLOW THE PLAYER. The shadow camera covers 3 km; the planet is 40,000 km around. If it did
    // not track, shadows would exist in exactly one place on Earth.
    scratch.focus.copy(playerBody.dir).multiplyScalar(playerBody.radius);
    target.position.copy(scratch.focus);
    target.updateMatrixWorld();
    // The light itself sits a few km up the sun ray. Distance only has to clear the tallest thing
    // that casts, and a nearer light means a tighter depth range and fewer artefacts.
    s.position.copy(scratch.focus).addScaledVector(scratch.toSun, SHADOW_SPAN_M / METRES_PER_UNIT);
    s.updateMatrixWorld();
  });

  const half = SHADOW_SPAN_M / METRES_PER_UNIT / 2;

  // THE OLD LIGHTING, exactly as it was: the shared world's ambient and hemisphere plus the blank-map
  // fill, and a directional light on a fixed world vector. Kept verbatim rather than approximated,
  // so "does turning it off fix it" is a real answer and not another variable.
  if (!newLook) {
    return (
      <>
        <ambientLight intensity={0.7} />
        <hemisphereLight args={['#ffffff', '#b9c4d0', 0.6]} />
        <directionalLight position={[400, 600, 300]} intensity={1.1} />
      </>
    );
  }

  return (
    <>
      {/*
        ONE KEY LIGHT, and it does nearly all the work. Well above the 1.1 it replaces, because the
        ambient it used to compete with is gone: with AgX tone mapping a strong key against a dark
        fill is what produces contrast, and contrast is the thing that was missing.

        2.4, down from the 3.2 first shipped. That was chosen against Lambert terrain, which ignores
        the scene environment; MeshStandardMaterial does not, so the swap quietly added the whole
        image-based ambient underneath it and the result blew out.
      */}
      <directionalLight
        ref={sun}
        color={SUN_COLOUR}
        intensity={2.4}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={0.1}
        shadow-camera-far={(SHADOW_SPAN_M * 2.5) / METRES_PER_UNIT}
        /*
          BIAS. Shadow acne on a planet-scale depth range is a certainty without it, and normalBias
          is the one to lean on rather than plain bias: it offsets along the surface normal, so it
          fixes self-shadowing on the terrain without detaching the Kaiju's shadow from its feet,
          which is what a large plain bias does (the "floating character" look).
        */
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        target={target}
      />
      <primitive object={target} />

      {/*
        SKY BOUNCE, and nothing else. A hemisphere light is not fill — it is the sky above and the
        ground below, which is physically what lights the shadow side of anything outdoors, and it
        keeps that side blue rather than black without flattening the form.
        0.55, against the 1.05 of flat ambient this replaces.
      */}
      <hemisphereLight args={[SKY_COLOUR, GROUND_BOUNCE, 0.55]} />
      {/*
        A trace of ambient, only so nothing is ever pure black. This used to be 0.35 plus another
        0.7 from the blank-map fill; at that level it is not a floor, it is a wash.
      */}
      <ambientLight intensity={0.12} />
    </>
  );
}
