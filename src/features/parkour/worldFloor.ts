/**
 * DreadRoot's ground plane, which is NOT in the collision grid.
 *
 * THE TRAP THIS EXISTS TO CLOSE. The grid holds placed blocks and nothing else.
 * The base ground the player walks on is a flat plane held up by a separate
 * check in the controller (`onWorldGround` → feet at y=0), and it is invisible
 * to anything that searches the grid. So every downward search — "how far is
 * the drop", "is there ground on the far side of this wall" — walked past the
 * real floor, found nothing, and reported UNKNOWN.
 *
 * Two visible bugs came out of that one hole:
 *   - running at an obstacle did nothing, because a vault is refused outright
 *     when the far side is unmeasurable, and over open ground it always was;
 *   - the free-fall pose played on a one-block hop, because the drop measured
 *     as "further than we looked" instead of one metre.
 *
 * Both are the same missing fact, so it lives in one place. The same constant
 * and the same reasoning are already in charlineup/lineupGround.ts, which hit
 * this from the other direction when the character row floated into the sky.
 */

/** Everything in the world sits on or above this. */
export const WORLD_FLOOR_Y = 0;

/**
 * The first real surface below `footY` in this column, given whatever the block
 * grid found.
 *
 * @param gridY  the top of the highest block found below, or null for none.
 * @returns the surface to stand on, or null when the feet are already at or
 *          below the floor and there is nothing to fall to.
 */
export function surfaceBelow(footY: number, gridY: number | null): number | null {
  if (gridY !== null) return gridY;
  return footY > WORLD_FLOOR_Y ? WORLD_FLOOR_Y : null;
}
