// challengeControl — a tiny bridge so the (proven) "!" spawner command can start/stop the
// challenge that the in-Canvas ChallengeRunner owns. The runner registers its toggle here.
let toggle: (() => void) | null = null;
export function setChallengeToggle(fn: (() => void) | null) { toggle = fn; }
export function fireChallengeToggle() { toggle?.(); }
