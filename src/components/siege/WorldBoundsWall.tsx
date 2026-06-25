// WorldBoundsWall — a HARD invisible-wall box for walled arena maps (e.g. Yeti Time). When the
// active world defines `wallBox`, the player's camera position is clamped inside it every frame on
// ALL sides — X/Z and (optionally) floor/ceiling. This is a position clamp, not a soft push, so it
// holds even while FLYING / in god-mode (the whole point: nobody leaves the arena, even airborne).
// A no-op (single map lookup) on any world without a wallBox, so it's safe to mount globally.
//
// Mounted as its own useFrame AFTER the controller + mesh-collider pass so it has the final say.

import { useFrame, useThree } from '@react-three/fiber';
import { getActiveMapId } from '@/config/activeMap';
import { getWorldDefinition } from '@/config/worldDefinition';

const MARGIN = 0.35;   // keep the player capsule a touch inside the wall (matches PLAYER_RADIUS)

export function WorldBoundsWall() {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const wb = getWorldDefinition(getActiveMapId()).wallBox;
    if (!wb) return;
    const minX = wb.min[0] + MARGIN, maxX = wb.max[0] - MARGIN;
    const minZ = wb.min[1] + MARGIN, maxZ = wb.max[1] - MARGIN;
    const p = camera.position;
    if (p.x < minX) p.x = minX; else if (p.x > maxX) p.x = maxX;
    if (p.z < minZ) p.z = minZ; else if (p.z > maxZ) p.z = maxZ;
    // Vertical lid/floor (camera sits at head height; ceiling caps the eye, floor is a safety net —
    // the ground-height clamp normally handles standing, this just stops flying out the top/bottom).
    if (wb.ceilingY != null && p.y > wb.ceilingY) p.y = wb.ceilingY;
    if (wb.floorY != null && p.y < wb.floorY) p.y = wb.floorY;
  });
  return null;
}
