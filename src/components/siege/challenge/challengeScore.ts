// challengeScore — a plain accumulator for the live challenge points. Damage dealt to monsters
// is added here (headshots earn 3× the points of the equivalent body shot); the HUD reads it on
// its own tick so a busy fight doesn't thrash React with a store update per bullet.
let score = 0;

export function resetChallengeScore() { score = 0; }
export function addChallengeScore(points: number) { score += points; }
export function getChallengeScore() { return score; }
