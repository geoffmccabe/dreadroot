// challengeControl — a tiny bridge so the (proven) "!" spawner command can start/stop the
// challenge that the in-Canvas ChallengeRunner owns, and so the player-damage pipeline can end
// it on death. The runner registers its handlers here.
import type { Challenge } from './challengeTypes';

let toggle: (() => void) | null = null;
let lose: (() => void) | null = null;
let startCh: ((ch: Challenge) => void) | null = null;
export function setChallengeToggle(fn: (() => void) | null) { toggle = fn; }
export function fireChallengeToggle() { toggle?.(); }
export function setChallengeLose(fn: (() => void) | null) { lose = fn; }
export function fireChallengeLose() { lose?.(); }   // no-op unless a challenge is running
export function setChallengeStart(fn: ((ch: Challenge) => void) | null) { startCh = fn; }
export function fireChallengeStart(ch: Challenge) { startCh?.(ch); }   // play a specific (authored) challenge
