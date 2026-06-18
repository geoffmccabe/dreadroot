// challengeStore — a tiny module singleton bridging the in-Canvas ChallengeRunner to the DOM HUD.
// The runner writes (wave, timer, announcement, completion); the HUD reads via useSyncExternalStore.
// Updates are infrequent (wave changes) — the HUD animates its own countdown from waveEndsAt.

export interface ChallengeAnnounce {
  title: string;        // e.g. "Wave 3/10"
  subtitle?: string;    // wave name
  image?: string;       // wave image URL
  text?: string;        // smaller advice/taunt line
  faint: boolean;       // carry-over announcement: 50% opacity, half as long
  until: number;        // performance.now() ms to hide at
}

export interface ChallengeState {
  active: boolean;
  name: string;
  wave: number;         // 1-10 (0 = not started)
  totalWaves: number;
  waveEndsAt: number;   // performance.now() ms when the wave times out (0 = none / final)
  announce: ChallengeAnnounce | null;
  completed: boolean;
  startedAt: number;    // performance.now() ms
  finishedAt: number;
}

let state: ChallengeState = {
  active: false, name: '', wave: 0, totalWaves: 10, waveEndsAt: 0,
  announce: null, completed: false, startedAt: 0, finishedAt: 0,
};
const listeners = new Set<() => void>();

export function getChallengeState(): ChallengeState { return state; }
export function subscribeChallenge(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function setChallengeState(patch: Partial<ChallengeState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
