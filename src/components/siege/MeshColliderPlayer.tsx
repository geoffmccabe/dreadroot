// MeshColliderPlayer — applies the BVH mesh-collider capsule push to the player
// each frame (the HORIZONTAL part: walls of rocks/mountains). Standing ON top of
// a mesh is handled separately by feeding meshGroundHeight() into the engine's
// existing ground-height system (same path as Siege terrain), which already does
// gravity/jump correctly. Mounted only in worlds that enable mesh colliders, and
// the resolve is internally gated, so it's a cheap no-op otherwise.
//
// Runs as its own useFrame; mounted AFTER the controller in the tree, so it
// resolves the finalized position each frame.

import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { resolvePlayerMeshCollision, setPlayerProbeY } from './meshColliderSystem';

const PLAYER_RADIUS = 0.3;   // matches FortressControls
const PLAYER_HEIGHT = 1.6;
const STEP_UP = 0.6;         // matches the controller's stepUpHeight
const MAX_PUSH = 1.5;        // sanity clamp — never teleport the player

export function MeshColliderPlayer() {
  const camera = useThree((s) => s.camera);
  const corr = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const feetY = camera.position.y - PLAYER_HEIGHT; // camera sits at the head
    // Tell the ground-raycast how high the player can step (so it only grounds
    // them on surfaces they can reach, never the top of a tall wall).
    setPlayerProbeY(feetY + STEP_UP);
    if (resolvePlayerMeshCollision(camera.position.x, feetY, camera.position.z, PLAYER_RADIUS, PLAYER_HEIGHT, corr)) {
      // HORIZONTAL only — vertical (standing on tops/slopes) is handled by the
      // ground-height clamp, which also zeroes velocity + sets onGround. Pushing
      // vertically here too would fight it and jitter. This pass is for walls.
      corr.y = 0;
      if (corr.lengthSq() <= MAX_PUSH * MAX_PUSH && corr.lengthSq() > 1e-8) {
        camera.position.x += corr.x;
        camera.position.z += corr.z;
      }
    }
  });
  return null;
}
