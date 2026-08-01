// GlobeCamera — makes the planet actually visible.
//
// Two engine defaults hide a 63,710-unit planet completely, and both had to be handled before
// anything could be seen (this is why 4.262.1 showed empty space):
//
//  1. FAR PLANE. Fortress.tsx creates the camera with far = 6,000. The Kaiju Lab spawns in orbit
//     160,000 units from the planet centre, so the nearest surface is 96,290 units away, far
//     outside the frustum. Everything was clipped.
//
//  2. FOG. FortressScene drives an exponential FogExp2 from the day/night sky system. At
//     tens of thousands of units, exp(-density * distance) is zero for any density at all, so
//     even with the far plane fixed the planet would render as solid fog colour.
//
// The far plane cannot simply be set to a huge constant: near = 0.1 with far = 400,000 is a
// 4,000,000:1 depth range and z-fighting destroys the terrain. Instead both planes track
// altitude, which is the standard approach for planet renderers.
//
// Everything here is restored on unmount, so leaving the map returns the camera and fog to
// exactly what the rest of the game expects.

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PLANET_RADIUS, METRES_PER_UNIT } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';

/** Extra margin past the horizon so the planet's limb and the far side of terrain stay in view. */
const FAR_MARGIN = 1.6;
const FAR_MIN = 2000;
/**
 * Near plane as a fraction of altitude, clamped.
 *
 * NEAR_MAX is deliberately SMALL (5, not thousands). A near plane scaled fully with altitude
 * would be ~1,900 units in orbit, which gives lovely depth precision and clips the first-person
 * weapon model and the third-person avatar out of existence, since both sit a couple of units
 * from the camera. This map is meant to keep every normal feature working, so the viewmodel wins
 * and we accept a larger depth ratio (about 47,000:1 in orbit, which a 24-bit buffer handles).
 * The ocean shell already draws with depthWrite off, so the one place this could bite, water
 * against coastline at extreme range, is handled by draw order rather than by depth.
 */
const NEAR_FRAC = 0.02;
/**
 * 0.03 units = 3 m, not 0.1 = 10 m.
 *
 * The near plane is the radius of a hole cut around the camera, and anything inside it is not
 * drawn. Standing at a person's eye height of 1.8 m, a 10 m near plane removes the ground under
 * your own feet, so you see straight through the hillside you are standing on. 3 m is below eye
 * height, which is the condition that has to hold.
 */
const NEAR_MIN = 0.03;
const NEAR_MAX = 5;

export function GlobeCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const saved = useRef<{ near: number; far: number; fog: THREE.Scene['fog']; bg: THREE.Scene['background'] } | null>(null);
  const underwaterCol = useRef(new THREE.Color());

  useEffect(() => {
    saved.current = { near: camera.near, far: camera.far, fog: scene.fog, bg: scene.background };
    return () => {
      const s = saved.current;
      if (!s) return;
      camera.near = s.near;
      camera.far = s.far;
      camera.updateProjectionMatrix();
      scene.fog = s.fog;
      scene.background = s.bg;
    };
  }, [camera, scene]);

  useFrame(() => {
    const p = camera.position;
    const d = Math.hypot(p.x, p.y, p.z);              // distance from the planet centre
    const altitude = d - PLANET_RADIUS;

    // UNDERWATER: murk that thickens with depth. Above water there is no fog at all, because the
    // sky system's exponential fog is opaque at planetary distances (see the header). This is the
    // one place fog is wanted, so it is set here rather than in a second component that would
    // fight GlobeCamera for scene.fog every frame.
    if (altitude < 0) {
      const depthM = -altitude * METRES_PER_UNIT;
      const t = Math.min(1, depthM / 3000);                 // full darkness by ~3 km down
      const col = underwaterCol.current.setRGB(
        0.02 + 0.06 * (1 - t), 0.10 + 0.22 * (1 - t), 0.20 + 0.38 * (1 - t),
      );
      const visibility = 900 - 700 * t;                     // units of clear sight
      const f = scene.fog as THREE.FogExp2 | null;
      if (f && (f as THREE.FogExp2).isFogExp2) {
        f.color.copy(col);
        (f as THREE.FogExp2).density = 1 / Math.max(20, visibility);
      } else {
        scene.fog = new THREE.FogExp2(col.getHex(), 1 / Math.max(20, visibility));
      }
      scene.background = col;
    } else {
      if (scene.fog) scene.fog = null;
      if (scene.background) scene.background = null;
    }

    // Distance to the horizon from here: the tangent line to a sphere of radius R from distance d.
    // Inside the planet this is imaginary, hence the max(0, ...).
    const tangent = Math.sqrt(Math.max(0, d * d - PLANET_RADIUS * PLANET_RADIUS));

    const far = Math.max(FAR_MIN, tangent * FAR_MARGIN + FAR_MIN);

    // NEAR PLANE FROM HEIGHT ABOVE THE GROUND, NOT ABOVE SEA LEVEL.
    //
    // Geoff: "the camera is set so that I can see below the terrain. I can see both below the
    // terrain and above it."
    //
    // `altitude` is measured from sea level, and the Grand Canyon rim is 2,100 m above sea level.
    // Standing there put the near plane at 42 m while the camera sat 1.8 m off the ground, so a
    // 42 m sphere of terrain around the viewer was clipped away and you looked straight through
    // the rim into the gorge below it. Measured from the GROUND the same spot gives essentially
    // zero, which floors at 3 m and leaves the ground you are standing on visible.
    //
    // This is the second time this exact mistake has cost a day: the scroll-wheel zoom step was
    // also scaled by altitude above sea level, which made one notch 8.4 km against a 500 m
    // subject. Anything that should scale with "how far am I from what I am looking at" must not
    // be measured from the centre of the planet.
    const groundM = d > 1e-6 ? sampleGlobeSurface(p.x / d, p.y / d, p.z / d) : null;
    const overGround = d - (PLANET_RADIUS + (groundM ?? 0) / METRES_PER_UNIT);
    const near = Math.min(NEAR_MAX, Math.max(NEAR_MIN, overGround * NEAR_FRAC));

    // Only touch the projection matrix when it actually changes materially, since
    // updateProjectionMatrix() is not free and this runs every frame.
    if (Math.abs(camera.far - far) > far * 0.02 || Math.abs(camera.near - near) > near * 0.02) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
