// WorldBoundsWall — a HARD invisible wall for walled arena maps (e.g. Yeti Time). When the active
// world defines `wallBox`, the player's camera position is kept inside it every frame on ALL sides.
// This is a position clamp (not a soft push), so it holds even while FLYING / in god-mode — the
// whole point: nobody leaves the arena, even airborne.
//
//   * `wallBox.polygon` (preferred): an irregular closed XZ polygon. Each frame we test the camera
//     with point-in-polygon; if it stepped outside, we snap it back to the last position that was
//     inside. That seals off an arbitrary edge-to-edge wall carved out of a larger map.
//   * `wallBox.min/max`: a simple axis-aligned box fallback when no polygon is given.
//   * floorY / ceilingY: optional vertical lid + floor (caps flying up/out the top, void below).
//
// Mounted as its own useFrame AFTER the controller + mesh-collider pass so it has the final say.

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { getActiveMapId } from '@/config/activeMap';
import { getWorldDefinition } from '@/config/worldDefinition';

const MARGIN = 0.35;   // keep the player capsule a touch inside a box wall (matches PLAYER_RADIUS)

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

export function WorldBoundsWall() {
  const camera = useThree((s) => s.camera);
  // Last camera XZ that was inside the polygon — where we snap back to on a cross attempt.
  const lastIn = useRef<{ x: number; z: number } | null>(null);
  const mapRef = useRef<string | null>(null);

  useFrame(() => {
    const mapId = getActiveMapId();
    const wb = getWorldDefinition(mapId).wallBox;
    if (mapId !== mapRef.current) { mapRef.current = mapId; lastIn.current = null; }   // reset on map change
    if (!wb) return;
    const p = camera.position;

    if (wb.polygon && wb.polygon.length >= 3) {
      if (inPoly(p.x, p.z, wb.polygon)) {
        lastIn.current = { x: p.x, z: p.z };   // remember the good spot
      } else if (lastIn.current) {
        p.x = lastIn.current.x; p.z = lastIn.current.z;   // bounced off the wall
      }
    } else {
      const minX = wb.min[0] + MARGIN, maxX = wb.max[0] - MARGIN;
      const minZ = wb.min[1] + MARGIN, maxZ = wb.max[1] - MARGIN;
      if (p.x < minX) p.x = minX; else if (p.x > maxX) p.x = maxX;
      if (p.z < minZ) p.z = minZ; else if (p.z > maxZ) p.z = maxZ;
    }

    // Vertical lid/floor (camera sits at head height; ceiling caps the eye, floor is a safety net).
    if (wb.ceilingY != null && p.y > wb.ceilingY) p.y = wb.ceilingY;
    if (wb.floorY != null && p.y < wb.floorY) p.y = wb.floorY;
  });
  return null;
}
