// worldBoundsClamp — the single authoritative "keep the player inside the arena" clamp for walled
// maps (e.g. Yeti Time / Snowy Cabin). It MUST run as the very last thing after the player has been
// moved each frame, or the mover overwrites it and the player ends the frame outside the wall (the
// "I can walk through the barrier" bug). So it is called at the END of the movement useFrame
// (SiegeFlyController) rather than from its own loosely-ordered useFrame.
//
// When the active world defines `wallBox`:
//   * `polygon` (preferred): an irregular closed XZ polygon. We point-in-polygon test the camera;
//     if it stepped outside, snap it back to the last position that was inside. Seals off an
//     arbitrary edge-to-edge wall carved out of a larger map, and holds at any speed / while flying.
//   * `min/max`: a simple axis-aligned box fallback when no polygon is given.
//   * floorY / ceilingY: optional vertical lid + floor.
//
// Single local player, so the "last inside" spot is module-level state (reset on map change).

import type { Camera } from 'three';
import { getActiveMapId } from '@/config/activeMap';
import { getWorldDefinition } from '@/config/worldDefinition';

const MARGIN = 0.35;   // keep the player capsule a touch inside a box wall (matches PLAYER_RADIUS)

let lastInX = 0, lastInZ = 0, haveLast = false, lastMap = '';

// Standard ray-casting point-in-polygon (XZ plane). poly = [[x,z], …] closed implicitly.
function inPoly(x: number, z: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function clampToWorldBounds(camera: Camera): void {
  const mapId = getActiveMapId();
  if (mapId !== lastMap) { lastMap = mapId; haveLast = false; }   // reset "last inside" on map change
  const wb = getWorldDefinition(mapId).wallBox;
  if (!wb) return;
  const p = camera.position;

  if (wb.polygon && wb.polygon.length >= 3) {
    if (inPoly(p.x, p.z, wb.polygon)) {
      lastInX = p.x; lastInZ = p.z; haveLast = true;   // remember the good spot
    } else if (haveLast) {
      p.x = lastInX; p.z = lastInZ;                     // bounced off the wall — snap back
    }
  } else {
    const minX = wb.min[0] + MARGIN, maxX = wb.max[0] - MARGIN;
    const minZ = wb.min[1] + MARGIN, maxZ = wb.max[1] - MARGIN;
    if (p.x < minX) p.x = minX; else if (p.x > maxX) p.x = maxX;
    if (p.z < minZ) p.z = minZ; else if (p.z > maxZ) p.z = maxZ;
  }

  if (wb.ceilingY != null && p.y > wb.ceilingY) p.y = wb.ceilingY;
  if (wb.floorY != null && p.y < wb.floorY) p.y = wb.floorY;
}
