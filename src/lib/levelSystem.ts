/**
 * Level progression system
 * 30 levels with exponential point requirements
 * Level 1 = 0, Level 2 = 100, each subsequent level = previous * 2
 */

export const MAX_LEVEL = 30;
export const BASE_POINTS_FOR_LEVEL_2 = 100;
export const POINTS_MULTIPLIER = 2;

// Pre-calculate point requirements for all levels
const levelPointRequirements: number[] = [];

export function calculatePointsForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level === 2) return BASE_POINTS_FOR_LEVEL_2;
  
  // Points = 100 * 2^(level-2) → L3=200, L4=400, L5=800, etc.
  return Math.floor(BASE_POINTS_FOR_LEVEL_2 * Math.pow(POINTS_MULTIPLIER, level - 2));
}

// Pre-calculate all level requirements
for (let i = 1; i <= MAX_LEVEL; i++) {
  levelPointRequirements.push(calculatePointsForLevel(i));
}

export function getPointsForLevel(level: number): number {
  if (level < 1 || level > MAX_LEVEL) return 0;
  return levelPointRequirements[level - 1];
}

/**
 * Get the level for a given number of total points
 */
export function getLevelForPoints(totalPoints: number): number {
  for (let level = MAX_LEVEL; level >= 1; level--) {
    if (totalPoints >= getPointsForLevel(level)) {
      return level;
    }
  }
  return 1;
}

/**
 * Get all level thresholds for display
 */
export function getAllLevelThresholds(): { level: number; pointsRequired: number }[] {
  return levelPointRequirements.map((points, index) => ({
    level: index + 1,
    pointsRequired: points,
  }));
}

/**
 * Check if points cross a level threshold
 */
export function checkLevelUp(oldPoints: number, newPoints: number): number | null {
  const oldLevel = getLevelForPoints(oldPoints);
  const newLevel = getLevelForPoints(newPoints);
  
  if (newLevel > oldLevel) {
    return newLevel;
  }
  return null;
}
