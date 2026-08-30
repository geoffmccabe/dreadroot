/**
 * A parkour test course, built in memory, for testing without a human.
 *
 * WHY THIS EXISTS. Every parkour bug so far has cost a round trip: Geoff walks
 * at a block, describes what he saw, and I guess from the description. Three
 * rounds went by with the scanner measuring perfectly correctly the whole time,
 * because "it climbs the air" and "the move is wrong for the height" look
 * identical from outside. A harness that drives the real game and reads the
 * real pose ends that.
 *
 * FOUR WALLS, ONE PER HEIGHT, one per compass direction:
 *
 *              north — 2 blocks
 *        west          @          east
 *      3 blocks     player      1 block
 *              south — 4 blocks
 *
 * So the height under test is chosen by turning, and a test can face a wall,
 * run at it, and turn to the next one without ever needing to be teleported
 * mid-run. The player is returned to the centre between attempts anyway,
 * because a vault ends up on the far side by design.
 *
 * BUILT STRAIGHT INTO THE COLLISION GRID, not through block placement. The
 * grid is what the scanner reads and what the player collides with, so a
 * course built there is indistinguishable from real blocks — and it never
 * touches the database, so a test cannot litter the world with test walls.
 * `clear()` removes exactly what was added and nothing else.
 */
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { WORLD_FLOOR_Y } from './worldFloor';

/** Where the course is built. Far from spawn so it cannot overlap real blocks. */
const CENTRE = { x: 400, z: 400 };
/** How far from the centre each wall sits — beyond the 1.1m reach, so the run
 *  up to it is a real approach and not a standing start. */
const DIST = 4;
/** Wall width either side of centre. Wide enough that a slight drift still
 *  meets the wall rather than rounding its corner. */
const HALF_WIDTH = 4;
/** Depth in blocks along the direction of travel. One block: thin enough that
 *  the classifier can offer a vault, which is half of what is being tested. */
const DEPTH = 1;

export interface CourseWall {
  /** Compass name, and what a test faces to reach it. */
  dir: 'east' | 'north' | 'west' | 'south';
  /** Blocks tall. */
  height: number;
  /** Yaw to face it, radians. Forward in this game is (-sin yaw, -cos yaw). */
  yaw: number;
}

/** One wall per height, so the height under test is chosen by turning. */
export const WALLS: CourseWall[] = [
  { dir: 'east',  height: 1, yaw: -Math.PI / 2 },
  { dir: 'north', height: 2, yaw: 0 },
  { dir: 'west',  height: 3, yaw: Math.PI / 2 },
  { dir: 'south', height: 4, yaw: Math.PI },
];

/** Every voxel this module added, so it can take back exactly what it put in. */
const added: Array<[number, number, number]> = [];

function forwardOf(yaw: number): { fx: number; fz: number } {
  return { fx: -Math.sin(yaw), fz: -Math.cos(yaw) };
}

export function buildCourse(): { centre: { x: number; y: number; z: number }; walls: CourseWall[] } {
  clearCourse();
  // A floor under the whole course. The world's own ground plane is at y=0 and
  // is not in the grid, so without this the player would stand on an invisible
  // plane while the walls sat in the grid — two different ideas of the ground,
  // which is the exact confusion that produced the far-side bug.
  for (let dx = -DIST - 3; dx <= DIST + 3; dx++) {
    for (let dz = -DIST - 3; dz <= DIST + 3; dz++) {
      add(CENTRE.x + dx, WORLD_FLOOR_Y - 1, CENTRE.z + dz);
    }
  }
  for (const w of WALLS) {
    const { fx, fz } = forwardOf(w.yaw);
    // Perpendicular, to lay the wall out sideways.
    const px = -fz, pz = fx;
    for (let d = 0; d < DEPTH; d++) {
      for (let s = -HALF_WIDTH; s <= HALF_WIDTH; s++) {
        const bx = Math.round(CENTRE.x + fx * (DIST + d) + px * s);
        const bz = Math.round(CENTRE.z + fz * (DIST + d) + pz * s);
        for (let h = 0; h < w.height; h++) add(bx, WORLD_FLOOR_Y + h, bz);
      }
    }
  }
  return { centre: { x: CENTRE.x, y: WORLD_FLOOR_Y, z: CENTRE.z }, walls: WALLS };
}

function add(x: number, y: number, z: number): void {
  worldCollisionGrid.addVoxel(x, y, z);
  added.push([x, y, z]);
}

/** Remove exactly what was added. Never a blanket clear — the real world's
 *  blocks are in the same grid. */
export function clearCourse(): void {
  for (const [x, y, z] of added) worldCollisionGrid.removeVoxel(x, y, z);
  added.length = 0;
}

export function courseCentre(): { x: number; y: number; z: number } {
  return { x: CENTRE.x, y: WORLD_FLOOR_Y, z: CENTRE.z };
}

/** Installed for scripts/check-parkour-course.mjs. Dev only — it mutates the
 *  collision grid, which no shipping code path should ever do. */
export function installCourseHooks(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>).__parkourCourse = {
    build: buildCourse,
    clear: clearCourse,
    centre: courseCentre,
    walls: () => WALLS,
  };
}
