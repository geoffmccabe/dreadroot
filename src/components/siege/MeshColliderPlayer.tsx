// MeshColliderPlayer — applies the BVH mesh-collider capsule push to the player
// each frame (the HORIZONTAL part: walls of rocks/mountains). Standing ON top of
// a mesh is handled separately by feeding meshGroundHeight() into the engine's
// existing ground-height system (same path as Siege terrain), which already does
// gravity/jump correctly. Mounted only in worlds that enable mesh colliders, and
// the resolve is internally gated, so it's a cheap no-op otherwise.
//
// Runs as its own useFrame; mounted AFTER the controller in the tree, so it
// resolves the finalized position each frame.
//
// SWEPT resolve: a single push-out at the final position only works for slow
// movement (you sink slightly into a wall, then get pushed back out). At Rocket
// Belt / super-sprint boost speed (~1.3 blocks/frame) you land fully PAST a thin
// wall, so there's nothing to push out of and you tunnel through. So we walk from
// last frame's position to the current one in sub-steps smaller than the player
// capsule, and STOP (pushed out) at the first wall — fast moves now collide.

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { resolvePlayerMeshCollision, setPlayerProbeY } from './meshColliderSystem';
import { sdbg } from './siegeDebug';
import { getBrushState } from './terrain/terrainBrushState';
import { getBuilder } from './builder/builderObjectsState';

const PLAYER_RADIUS = 0.3;   // matches FortressControls
const PLAYER_HEIGHT = 1.6;
const STEP_UP = 0.6;         // matches the controller's stepUpHeight
const MAX_PUSH = 1.5;        // sanity clamp — never teleport the player
const SWEEP_STEP = 0.3;      // < player width (2*0.3) → no gaps along the path
const TELEPORT_MAX = 4.0;    // a jump bigger than this is a teleport, not movement — don't sweep

export function MeshColliderPlayer() {
  const camera = useThree((s) => s.camera);
  const corr = useMemo(() => new THREE.Vector3(), []);
  const lastPos = useRef<THREE.Vector3 | null>(null);

  useFrame(() => {
    // Stand down while sculpting/building: the per-frame camera push fights the terrain brush's
    // aim and object placement (it once broke sculpting entirely). Keep the sweep origin current so
    // resuming play doesn't sweep across the whole edit.
    if (getBrushState().enabled || getBuilder().enabled) {
      if (!lastPos.current) lastPos.current = new THREE.Vector3();
      lastPos.current.copy(camera.position);
      return;
    }
    // God mode = fly through everything: skip the mesh push, but keep the sweep
    // origin current so exiting god mode doesn't sweep across the whole fly path.
    if (sdbg.godMode) {
      if (!lastPos.current) lastPos.current = new THREE.Vector3();
      lastPos.current.copy(camera.position);
      return;
    }

    const feetY = camera.position.y - PLAYER_HEIGHT; // camera sits at the head
    // Tell the ground-raycast how high the player can step (so it only grounds
    // them on surfaces they can reach, never the top of a tall wall).
    setPlayerProbeY(feetY + STEP_UP);

    // Resolve at an explicit (x,z); writes the push into `corr`. Returns true if a
    // valid (within MAX_PUSH) horizontal push was found.
    const resolveAt = (x: number, z: number): boolean => {
      if (!resolvePlayerMeshCollision(x, feetY, z, PLAYER_RADIUS, PLAYER_HEIGHT, corr)) return false;
      corr.y = 0; // HORIZONTAL only — vertical is the ground-height clamp's job (avoids jitter)
      return corr.lengthSq() <= MAX_PUSH * MAX_PUSH && corr.lengthSq() > 1e-8;
    };

    const prev = lastPos.current;
    const dx = prev ? camera.position.x - prev.x : 0;
    const dz = prev ? camera.position.z - prev.z : 0;
    const dist = Math.hypot(dx, dz);

    if (prev && dist > SWEEP_STEP && dist <= TELEPORT_MAX) {
      // Swept resolve: step from prev → current; stop & push out at the first wall.
      const n = Math.ceil(dist / SWEEP_STEP);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const sx = prev.x + dx * t;
        const sz = prev.z + dz * t;
        if (resolveAt(sx, sz)) {
          camera.position.x = sx + corr.x;
          camera.position.z = sz + corr.z;
          break; // hit a wall — stop here instead of tunnelling onward
        }
        camera.position.x = sx;
        camera.position.z = sz;
      }
    } else if (resolveAt(camera.position.x, camera.position.z)) {
      // Small move (or a teleport we don't sweep): single push-out at the current pos.
      camera.position.x += corr.x;
      camera.position.z += corr.z;
    }

    // Remember the resolved position for next frame's sweep origin.
    if (!lastPos.current) lastPos.current = new THREE.Vector3();
    lastPos.current.set(camera.position.x, camera.position.y, camera.position.z);
  });

  return null;
}
