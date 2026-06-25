// worldBoundsClamp — the authoritative invisible-wall enforcement for walled maps (Snowy Cabin).
// It MUST run as the very last thing after the player has moved each frame (called at the end of
// SiegeFlyController's movement), or the mover overwrites it and the player ends the frame on the
// wrong side.
//
// The wall is an OPEN XZ polyline (`wallBox.line`) that the player cannot CROSS while below
// `wallBox.height` metres above the terrain. We test the player's movement this frame as a SEGMENT
// (previous XZ → current XZ) against every wall segment; if it crosses one and the player is below
// the wall top, we revert XZ to the previous spot. Because it's a swept segment test it holds at any
// horizontal speed (no tunnelling), and because it only blocks BELOW the height, a determined
// vertical boost over the top is allowed (drops the player into the rest of the map).
//
// Single local player, so the previous-position state is module-level (reset on map change).

import type { Camera } from 'three';
import { getActiveMapId } from '@/config/activeMap';
import { getWorldDefinition } from '@/config/worldDefinition';
import { sampleHeight } from './terrainHeight';

let prevX = 0, prevZ = 0, havePrev = false, lastMap = '';

// True if segments AB and CD intersect (standard orientation test; collinear-touch ignored, fine here).
function ccw(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  return (cz - az) * (bx - ax) > (bz - az) * (cx - ax);
}
function segCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  return ccw(ax, az, cx, cz, dx, dz) !== ccw(bx, bz, cx, cz, dx, dz)
      && ccw(ax, az, bx, bz, cx, cz) !== ccw(ax, az, bx, bz, dx, dz);
}

export function clampToWorldBounds(camera: Camera): void {
  const mapId = getActiveMapId();
  if (mapId !== lastMap) { lastMap = mapId; havePrev = false; }   // reset on map change
  const wb = getWorldDefinition(mapId).wallBox;
  if (!wb) return;
  const p = camera.position;

  if (wb.floorY != null && p.y < wb.floorY) p.y = wb.floorY;   // void floor

  const line = wb.line;
  if (line && line.length >= 2) {
    // Wall is only solid below `height` metres above the local terrain. Above it → free to pass.
    const ground = sampleHeight(p.x, p.z) ?? 0;
    const belowTop = (p.y - ground) < wb.height;
    if (havePrev && belowTop && (prevX !== p.x || prevZ !== p.z)) {
      let crossed = false;
      for (let i = 0; i < line.length - 1; i++) {
        if (segCross(prevX, prevZ, p.x, p.z, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1])) {
          crossed = true; break;
        }
      }
      if (crossed) { p.x = prevX; p.z = prevZ; }   // can't cross the wall below its top
    }
    prevX = p.x; prevZ = p.z; havePrev = true;
  }
}
