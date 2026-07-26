// GlobeOcean — the sea-level shell for the Mini Earth map (step B5 of MINI_EARTH_P1_BUILD.md).
//
// A single sphere at elevation zero, i.e. exactly PLANET_RADIUS. The terrain quadtree renders
// the true relief including the sea floor; this shell is what turns a lumpy grey ball into a
// recognisable planet, because coastlines only read as coastlines once there is water.
//
// Deliberately simple for P1: one sphere, one material, no waves and no depth shading. The real
// ocean (depth-driven visibility, swimming, underwater fog) is P4.

import { useMemo } from 'react';
import * as THREE from 'three';
import { PLANET_RADIUS } from './cubeSphere';

/** Segment counts: enough that the horizon silhouette is smooth from orbit. */
const WIDTH_SEG = 192;
const HEIGHT_SEG = 96;

export function GlobeOcean() {
  const geometry = useMemo(
    () => new THREE.SphereGeometry(PLANET_RADIUS, WIDTH_SEG, HEIGHT_SEG),
    [],
  );

  const material = useMemo(
    () => new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.06, 0.22, 0.42),
      transparent: true,
      opacity: 0.88,
      // The shell is a closed sphere sitting above the sea floor, so its back faces are what
      // you see from underwater. Rendering both sides keeps it from vanishing when the camera
      // drops below sea level.
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,   // see GlobeTerrain: planetary distances make the sky system's fog opaque
    }),
    [],
  );

  return <mesh geometry={geometry} material={material} name="globe-ocean" renderOrder={1} />;
}
