/**
 * GameInstanceDO — the Cloudflare Durable Object that hosts ONE live L2 game
 * instance. Deliberately THIN: all real logic lives in the fully-tested,
 * Cloudflare-free GameInstanceCore. This file only does the platform glue —
 * WebSocket accept, a 20 Hz timer, and shipping the per-client buffers.
 *
 * Uses the standard (non-hibernation) WebSocket API + setInterval: a real-time
 * tick needs the DO resident in memory, so we DON'T hibernate. The timer is
 * cleared when the last client leaves, letting the DO go idle.
 *
 * In-memory state only for now; draining authoritative changes to L1 (Supabase)
 * is Track 5. NOTE: untested in this repo's Node test suite — validate with
 * `wrangler dev` (see worker/README.md). It wraps already-tested code.
 */
import { GameInstanceCore } from '../src/features/netcode/server/gameInstanceCore';
import { TICK_MS } from '../src/features/netcode/server/tickLoop';

export interface Env {
  GAME_INSTANCE: DurableObjectNamespace;
  /** Optional shared-secret join gate (set via `wrangler secret put JOIN_SECRET`).
   *  Placeholder until per-user tokens are issued by L1. */
  JOIN_SECRET?: string;
  /** Optional AoI radius override (blocks), e.g. per game. Default 80. */
  AOI_RADIUS?: string;
  /** 'off' disables server-owned monsters for this deployment. */
  ENEMIES?: string;
  /** Seeds monster placement. Must match the client's world seed. */
  WORLD_SEED?: string;
  /** Scales monster population. 1 = the game's own (very sparse) tuning. */
  ENEMY_DENSITY?: string;
}

const DEFAULT_AOI_RADIUS = 80;

/**
 * Instances whose id starts with this run a DENSE monster profile.
 *
 * Real spawn density is calibrated to the game's own tuning (about 1% per
 * minute), which is far too sparse to observe in a short test — the expected
 * wait is over an hour. A test instance is fully isolated from real worlds
 * (one Durable Object per id) and still bounded by maxAlive, so this affects
 * nothing a player can reach. It exists so the live end-to-end test can
 * actually see a monster.
 */
const TEST_INSTANCE_PREFIX = 'smoke-';

/** Message budget window and cap. ~20 inputs/sec is normal play; 200 per
 *  2 seconds leaves a wide margin for bursts and reconnect chatter. */
const RATE_WINDOW_MS = 2000;
const MAX_MESSAGES_PER_WINDOW = 200;

export class GameInstanceDO {
  private core: GameInstanceCore;
  private conns = new Map<WebSocket, string>(); // ws → clientId
  /** Per-connection message budget. Cloudflare's own rate limiting acts on the
   *  HTTP upgrade and then stops, so everything per-frame is ours to police.
   *  A client sends ~20 inputs/sec; this allows a generous burst above that
   *  and hangs up on sustained flooding, which is both a cost and a CPU
   *  protection on an endpoint that has no authentication yet. */
  private budget = new Map<WebSocket, { count: number; windowStart: number }>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private nextClient = 1;
  private outBuffers = new Map<string, ArrayBuffer>();

  /** Set once, from the first request, since the instance name is not
   *  available in the constructor. */
  private profileApplied = false;

  constructor(_state: DurableObjectState, env: Env) {
    // worldId/zoneId are fixed at 1/0 for now (single-world per instance);
    // multi-world routing is a Track 5 lifecycle concern.
    this.core = new GameInstanceCore({
      worldId: 1,
      zoneId: 0,
      aoiRadius: Number(env.AOI_RADIUS) || DEFAULT_AOI_RADIUS,
      // Server-owned monsters (stage 5). Set ENEMIES=off to run a
      // players-only instance, which is what this was before.
      enemies: env.ENEMIES === 'off' ? false : {
        worldSeed: env.WORLD_SEED ?? 'dreadroot',
        densityMultiplier: Number(env.ENEMY_DENSITY) || 1,
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.profileApplied) {
      this.profileApplied = true;
      const instance = new URL(request.url).searchParams.get('instance') ?? '';
      if (instance.startsWith(TEST_INSTANCE_PREFIX)) {
        // Dense enough to observe in seconds. Isolated to this instance and
        // still capped by maxAlive; nothing a player can reach is affected.
        // Also a wide detection range: monsters spawn 2-4 chunks out, so with
        // the real 24-block range they would (correctly) just stand there and
        // the test could not observe movement at all.
        this.core.getEnemySim()?.setConfig({
          spawnChancePerMinute: 100000, maxAlive: 20, detectionRange: 5000,
        });
      }
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    // Ask the runtime to deliver binary frames as ArrayBuffer (workerd defaults
    // to Blob, like browsers). Best-effort; the message handler also copes.
    try { (server as unknown as { binaryType: string }).binaryType = 'arraybuffer'; } catch { /* ignore */ }
    this.onConnect(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private onConnect(ws: WebSocket): void {
    const clientId = `c${this.nextClient++}`;
    // Reject if this world is at its player cap (abuse / overload guard).
    if (this.core.addPlayer(clientId) === null) {
      try { ws.close(1013, 'world full'); } catch { /* already closing */ }
      return;
    }
    this.conns.set(ws, clientId);

    // Greet immediately: tell the client which entity is theirs and which RUN
    // of this object they reached. Without the entity id a client cannot find
    // itself in a snapshot; without the session id it cannot tell a restart
    // (tick counter back to 0) from an out-of-order packet, and would discard
    // every later snapshot forever. Cloudflare resets every live Durable
    // Object on each code deploy, so that is guaranteed, not hypothetical.
    const hello = this.core.buildHello(clientId);
    if (hello !== null) {
      try { ws.send(hello); }
      catch { this.onClose(ws); return; }
    }

    ws.addEventListener('message', (ev: MessageEvent) => {
      if (!this.allowMessage(ws)) return;
      const d = ev.data;
      if (d instanceof ArrayBuffer) {
        this.core.applyClientMessage(clientId, d);
      } else if (ArrayBuffer.isView(d)) {
        const v = d as ArrayBufferView;
        this.core.applyClientMessage(clientId, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
      } else if (d && typeof (d as Blob).arrayBuffer === 'function') {
        // workerd delivers binary as a Blob by default — unwrap it.
        (d as Blob).arrayBuffer().then((b) => this.core.applyClientMessage(clientId, b)).catch(() => { /* ignore */ });
      }
    });
    const drop = () => this.onClose(ws);
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);

    this.ensureTicking();
  }

  /** True if this connection is within its message budget. Closes it if not. */
  private allowMessage(ws: WebSocket): boolean {
    const now = Date.now();
    let b = this.budget.get(ws);
    if (b === undefined) { b = { count: 0, windowStart: now }; this.budget.set(ws, b); }
    if (now - b.windowStart >= RATE_WINDOW_MS) { b.count = 0; b.windowStart = now; }
    b.count++;
    if (b.count > MAX_MESSAGES_PER_WINDOW) {
      // Distinct close code so flooding is distinguishable from a normal drop
      // in the logs; that separation is free telemetry on who is probing.
      try { ws.close(1008, 'rate limit'); } catch { /* already closing */ }
      this.onClose(ws);
      return false;
    }
    return true;
  }

  private onClose(ws: WebSocket): void {
    const clientId = this.conns.get(ws);
    if (clientId === undefined) return;
    this.core.removePlayer(clientId);
    this.conns.delete(ws);
    this.budget.delete(ws);
    if (this.conns.size === 0) this.stopTicking();
  }

  private ensureTicking(): void {
    if (this.interval === null) this.interval = setInterval(() => this.onTick(), TICK_MS);
  }
  private stopTicking(): void {
    if (this.interval !== null) { clearInterval(this.interval); this.interval = null; }
  }

  private onTick(): void {
    if (!this.core.tick(Date.now(), this.outBuffers)) return;
    for (const [ws, clientId] of this.conns) {
      const buf = this.outBuffers.get(clientId);
      if (buf) {
        try { ws.send(buf); }
        catch { this.onClose(ws); }
      }
    }
  }
}
