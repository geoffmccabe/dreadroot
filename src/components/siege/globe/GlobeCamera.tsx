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
import { PLANET_RADIUS } from './cubeSphere';

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
const NEAR_MIN = 0.1;
const NEAR_MAX = 5;

export function GlobeCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  const saved = useRef<{ near: number; far: number; fog: THREE.Scene['fog']; bg: THREE.Scene['background'] } | null>(null);

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
    // Re-assert every frame: FortressScene's sky/fog system writes scene.fog continuously, so a
    // one-shot clear in an effect gets overwritten. (Same pattern NightDimmer already uses.)
    if (scene.fog) scene.fog = null;

    const p = camera.position;
    const d = Math.hypot(p.x, p.y, p.z);              // distance from the planet centre
    const altitude = d - PLANET_RADIUS;

    // Distance to the horizon from here: the tangent line to a sphere of radius R from distance d.
    // Inside the planet this is imaginary, hence the max(0, ...).
    const tangent = Math.sqrt(Math.max(0, d * d - PLANET_RADIUS * PLANET_RADIUS));

    const far = Math.max(FAR_MIN, tangent * FAR_MARGIN + FAR_MIN);
    const near = Math.min(NEAR_MAX, Math.max(NEAR_MIN, altitude * NEAR_FRAC));

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
