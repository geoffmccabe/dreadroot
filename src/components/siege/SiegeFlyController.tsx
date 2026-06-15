// SiegeFlyController — a lean first-person controller for Siege Worlds worlds.
//
// Matches Dreadroot's control scheme + movement feel (WASD, Shift = run,
// Space = jump, F = toggle fly) but carries NONE of Dreadroot's voxel/gameplay
// coupling. For slice 1a it stands on the config-driven ground (WorldDefinition);
// collider-grid + water-volume collision get wired in later slices.
//
// All world-specific values come from the WorldDefinition — no hardcoded map size.

import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldDefinition } from '@/config/worldDefinition';
import { sampleHeight } from './terrainHeight';
import { playerState } from './playerState';

// Movement constants — chosen to match Dreadroot's controls.
const WALK_SPEED = 5.5;   // m/s
const RUN_SPEED = 11;     // m/s (Shift)
const FLY_SPEED = 22;     // m/s (free flight)
const SUPER_SPEED_MULT = 4; // E held = super speed (any direction)
const GRAVITY = 9.8;      // m/s^2
const JUMP_HEIGHT = 1.25; // m  -> jump velocity below
const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
const EYE_HEIGHT = 1.6;   // camera height above the player's feet

interface Props {
  world: WorldDefinition;
}

export function SiegeFlyController({ world }: Props) {
  const camera = useThree((s) => s.camera);

  const keys = useRef<Set<string>>(new Set());
  const flying = useRef(false);
  const velY = useRef(0);
  const onGround = useRef(false);

  const fallbackY = world.ground.surfaceY ?? 0;
  // Ground (feet) height at world x,z — follows terrain, falls back to flat surface.
  const groundAt = (x: number, z: number) => sampleHeight(x, z) ?? fallbackY;

  // scratch vectors (avoid per-frame GC)
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());

  // Spawn the camera at the world's spawn point.
  useEffect(() => {
    const [sx, sy, sz] = world.spawn.position;
    camera.position.set(sx, Math.max(sy + EYE_HEIGHT, groundAt(sx, sz) + EYE_HEIGHT), sz);
    camera.rotation.set(0, world.spawn.yaw ?? 0, 0);
    onGround.current = true;
    velY.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current.add(e.code);
      // God-mode / fly toggle — Dreadroot convention: ` (Backquote). F kept as an alias.
      if (e.code === 'Backquote' || e.code === 'KeyF') flying.current = !flying.current;
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // clamp big frame gaps
    const k = keys.current;

    // Horizontal basis from camera yaw (ignore pitch so movement stays level).
    forward.current.set(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.set(1, 0, 0).applyQuaternion(camera.quaternion);
    right.current.y = 0;
    right.current.normalize();

    move.current.set(0, 0, 0);
    if (k.has('KeyW')) move.current.add(forward.current);
    if (k.has('KeyS')) move.current.sub(forward.current);
    if (k.has('KeyD')) move.current.add(right.current);
    if (k.has('KeyA')) move.current.sub(right.current);

    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const boost = k.has('KeyE') ? SUPER_SPEED_MULT : 1; // E = super speed
    const speed = (flying.current ? FLY_SPEED : running ? RUN_SPEED : WALK_SPEED) * boost;

    if (move.current.lengthSq() > 0) {
      move.current.normalize().multiplyScalar(speed * dt);
      camera.position.x += move.current.x;
      camera.position.z += move.current.z;
    }

    if (flying.current) {
      // God-mode vertical: Q = up, Z = down (E = super speed).
      const vy = FLY_SPEED * boost * dt;
      if (k.has('KeyQ')) camera.position.y += vy;
      if (k.has('KeyZ')) camera.position.y -= vy;
      velY.current = 0;
      onGround.current = false;
    } else {
      // Gravity + jump, clamped to the ground. If terrain isn't loaded yet (or we're
      // off-map), HOLD position instead of falling into the void at fallback Y=0.
      const g = sampleHeight(camera.position.x, camera.position.z);
      if (g === null) {
        velY.current = 0; // don't accumulate fall while terrain streams in
      } else {
        if (k.has('Space') && onGround.current) {
          velY.current = JUMP_VELOCITY;
          onGround.current = false;
        }
        velY.current -= GRAVITY * dt;
        camera.position.y += velY.current * dt;
        const floorY = g + EYE_HEIGHT;
        if (camera.position.y <= floorY) {
          camera.position.y = floorY;
          velY.current = 0;
          onGround.current = true;
        }
      }
    }

    // publish position + facing for the coordinate HUD
    playerState.x = camera.position.x;
    playerState.y = camera.position.y;
    playerState.z = camera.position.z;
    playerState.fx = forward.current.x;
    playerState.fz = forward.current.z;
  });

  return <PointerLockControls />;
}
