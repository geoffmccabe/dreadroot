/**
 * prediction (Track 4D) — client-side prediction + server reconciliation for the
 * LOCAL player. The player moves immediately on input (no round-trip wait); when
 * the server's authoritative position for an acked input arrives, we snap to it
 * and REPLAY the inputs the server hasn't processed yet — so a correct prediction
 * is seamless and a misprediction self-heals.
 *
 * Remote players/enemies are INTERPOLATED (see remoteEntities.ts); only the local
 * player is predicted. PURE: caller supplies inputs + authoritative state.
 */
import { stepPlayer, type PlayerState, type PlayerInputCmd, PLAYER_SPEED } from './playerSim';
import { TICK_MS } from './server/tickLoop';

/** Cap unacked-input history so a stalled/un-acking server can't leak memory
 *  (~6 s at 20 Hz). Oldest are dropped — prediction degrades, never leaks. */
const MAX_PENDING = 128;

export class PredictedPlayer {
  /** Current predicted state — what the renderer draws for the local player. */
  readonly state: PlayerState;
  /** Inputs applied locally but not yet acked by the server (for replay). */
  private pending: PlayerInputCmd[] = [];
  private speed: number;
  /**
   * The dt cap the SERVER will apply. Prediction must use the identical cap.
   *
   * This was previously left uncapped on the client, with the reasoning that
   * it would "predict with real frame time, then reconcile to the server's
   * capped result". That does not work: any input carrying more time than one
   * tick is applied in full locally and clipped to one tick by the server, so
   * the client over-predicts EVERY time and reconciliation drags the player
   * backwards without ever converging.
   *
   * Caught by the live dress rehearsal against the deployed server: sending
   * 100 ms inputs against a 50 ms tick produced exactly 2x over-prediction and
   * a divergence that grew linearly to 6.3 blocks over 20 inputs.
   */
  private maxDtMs: number;

  constructor(initial: PlayerState, speed: number = PLAYER_SPEED, maxDtMs: number = TICK_MS) {
    this.state = { x: initial.x, y: initial.y, z: initial.z, yaw: initial.yaw };
    this.speed = speed;
    this.maxDtMs = maxDtMs;
  }

  setSpeed(speed: number): void { this.speed = speed; }
  setMaxDtMs(ms: number): void { this.maxDtMs = ms; }

  /** Apply an input locally for immediate response, and remember it for replay.
   *  The caller also sends `cmd` to the server. */
  predict(cmd: PlayerInputCmd): void {
    stepPlayer(this.state, cmd, this.speed, this.maxDtMs);
    this.pending.push(cmd);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  /**
   * Server reconciliation: `authState` is where the server says the player was
   * after processing input `ackedSeq`. Drop acked inputs, snap to authority, and
   * replay everything still pending → back to the current predicted position.
   * If the prediction was right, the visible position doesn't move.
   */
  reconcile(authState: PlayerState, ackedSeq: number): void {
    let i = 0;
    while (i < this.pending.length && this.pending[i].seq <= ackedSeq) i++;
    if (i > 0) this.pending.splice(0, i);

    this.state.x = authState.x;
    this.state.y = authState.y;
    this.state.z = authState.z;
    this.state.yaw = authState.yaw;
    for (let j = 0; j < this.pending.length; j++) stepPlayer(this.state, this.pending[j], this.speed, this.maxDtMs);
  }

  /** Inputs awaiting server ack (for diagnostics / tests). */
  pendingCount(): number { return this.pending.length; }
}
