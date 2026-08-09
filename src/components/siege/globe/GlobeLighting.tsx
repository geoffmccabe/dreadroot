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
import { setGlobeActive } from '@/features/look/globeActive';

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
   * THIS MAP IS ON SCREEN. Cleared on unmount, so leaving takes the grade with it.
   *
   * Without this the persisted `enabled` flag alone was letting the Mini Earth's grade run on every
   * other world — the whole game blown out because a panel had been switched on once.
   */
  useEffect(() => {
    setGlobeActive(true);
    return () => setGlobeActive(false);
  }, []);

  /**
   * PUT EVERY BORROWED VALUE BACK WHEN THE MAP UNMOUNTS.
   *
   * Separate from the toggles below, and deliberately so. Those restore when a SWITCH changes; this
   * restores when the map goes away, which is a different moment and the one that leaks. The
   * originals are captured once on mount, never on re-run: a cleanup that re-reads the current value
   * restores whatever the last effect wrote, which is not a restore at all.
   */
  useEffect(() => () => {
    // Hand the renderer's exposure back to whatever the shared look store says.
    gl.toneMappingExposure = lookStore.get().exposure;
    // Hand back every light this file scaled, wherever it lives.
    scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && l.userData.baseIntensity !== undefined) {
        l.intensity = l.userData.baseIntensity;
        delete l.userData.baseIntensity;
      }
    });
  }, [scene, gl]);

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

  /**
   * Put everyone else's lights back.
   *
   * The scaler above writes directly into lights this file does not own, so leaving the map — or
   * simply switching the master off — has to restore them. Without this, turning the panel off
   * would leave the world permanently dark, which is a far worse bug than the one being fixed.
   */
  useEffect(() => {
    if (on) return;
    scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight && l.userData.baseIntensity !== undefined) {
        l.intensity = l.userData.baseIntensity;
      }
    });
  }, [scene, on]);

  /** Render resolution. See the note on `dpr` in the store for why this is the sharpness lever. */
  useEffect(() => {
    if (!on || look.dpr <= 1) return;
    const had = gl.getPixelRatio();
    // Never ask for more than the display has: on a 1x screen that is pure waste.
    setDpr(Math.min(look.dpr, typeof window !== 'undefined' ? window.devicePixelRatio : 1));
    return () => setDpr(had);
  }, [gl, setDpr, on, look.dpr]);

  /**
   * EXPOSURE IS SET ON THE RENDERER, NOT IN THE SHARED STORE.
   *
   * It used to go through lookStore, which PERSISTS TO LOCALSTORAGE. So a night exposure of 0.55 was
   * being written into the game's saved settings and carried to every other map and every future
   * session — a lighting change that outlived the map that made it, survived a reload, and had no
   * obvious way back. That is a far worse kind of bug than a wrong number: it escapes.
   *
   * Written straight onto the renderer each frame instead. Nothing is saved, nothing leaks, and
   * unmounting simply stops writing — at which point LookSync's own value is authoritative again.
   */

  /**
   * THE NIGHT SKY. Guarded on the master switch like everything else here.
   *
   * SiegeWorldScene paints a light blue background and mounts a drei <Sky> configured for midday.
   * Neither is LIT — they are bright in themselves — so no amount of dimming lights touches them,
   * which is why the scene could not be made to go dark. The dome is HIDDEN rather than unmounted,
   * because it belongs to a component shared with every other map, and put back on the way out.
   *
   * This was silently lost in an earlier edit, which left the panel's Sky toggle doing nothing at
   * all — a control that lies is worse than no control.
   */
  useEffect(() => {
    if (!on || look.skyMode !== 'night') return;
    const hadBg = scene.background;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      // drei's Sky is a large mesh with a shader material and no name. Identifying it by its
      // uniforms is the reliable way — matching on class would also catch the starfield and the
      // cloud shells, and hiding the starfield at night is the opposite of the intent.
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && m.uniforms && 'sunPosition' in m.uniforms && 'rayleigh' in m.uniforms && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    scene.background = new THREE.Color(0x05070d);
    return () => {
      for (const o of hidden) o.visible = true;
      scene.background = hadBg;
    };
  }, [scene, on, look.skyMode]);

  useFrame(() => {
    const g = globeLook();

    // Exposure, straight onto the renderer. See the note above on why this does not go through the
    // persisted store.
    if (g.enabled && g.gradeOn) gl.toneMappingExposure = g.exposure;

    // HOLD THE SHADOW MAP ON, EVERY FRAME. This is why shadows still did not appear.
    //
    // The Canvas is created with `shadows={shadowsEnabled}` — a global toggle, default OFF, bound to
    // the '-' key — and react-three-fiber OWNS that flag: it re-applies it from the prop whenever the
    // Canvas re-renders, which in this app is often. So setting it once in an effect worked for a
    // few frames and was then quietly switched back off, with everything else about the shadow
    // pipeline correct and nothing to see. Asserting it each frame is one boolean write and it
    // simply cannot be lost.
    if (g.enabled && g.shadowsOn) {
      if (!gl.shadowMap.enabled) { gl.shadowMap.enabled = true; gl.shadowMap.needsUpdate = true; }
      const cam = sun.current?.shadow.camera;
      // The bounds come from a slider, and three does not rebuild the projection when they change —
      // so without this the shadow camera keeps whatever area it was first compiled with.
      if (cam && cam.right !== g.shadowSpanM / METRES_PER_UNIT / 2) {
        const half = g.shadowSpanM / METRES_PER_UNIT / 2;
        cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
        cam.far = (g.shadowSpanM * 2.5) / METRES_PER_UNIT;
        cam.updateProjectionMatrix();
      }
    }

    // SCALE EVERY LIGHT THAT IS NOT MINE.
    //
    // Three lights live in SiegeWorldScene — ambient 0.35, hemisphere 0.6, directional 1.1 — added
    // to every world and never on this panel. They are why switching the sun off left the map lit by
    // somebody else's midday. Held every frame rather than set once, because the shared day/night
    // controller re-asserts intensities and would otherwise win; NightDimmer already does exactly
    // this on the SciFi City map, which is the proof the approach holds.
    if (g.enabled && g.worldLights < 1) {
      scene.traverse((o) => {
        const l = o as THREE.Light;
        if (!l.isLight || l.userData.globeOwned) return;
        if (l.userData.baseIntensity === undefined) l.userData.baseIntensity = l.intensity;
        l.intensity = l.userData.baseIntensity * g.worldLights;
      });
    }

    const s = sun.current;
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
      {look.fillAmbient > 0 && <ambientLight intensity={look.fillAmbient} userData={{ globeOwned: true }} />}
      {look.fillHemi > 0 && (
        <hemisphereLight args={[SKY_COLOUR, GROUND_BOUNCE, look.fillHemi]} userData={{ globeOwned: true }} />
      )}

      {look.sunOn && (
        <>
          <directionalLight
            ref={sun}
            userData={{ globeOwned: true }}
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
        <hemisphereLight args={[SKY_COLOUR, GROUND_BOUNCE, look.skyBounce]} userData={{ globeOwned: true }} />
      )}
    </>
  );
}
