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
}

const AOI_RADIUS = 80;

export class GameInstanceDO {
  private core: GameInstanceCore;
  private conns = new Map<WebSocket, string>(); // ws → clientId
  private interval: ReturnType<typeof setInterval> | null = null;
  private nextClient = 1;
  private outBuffers = new Map<string, ArrayBuffer>();

  constructor(_state: DurableObjectState, _env: Env) {
    this.core = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: AOI_RADIUS });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.onConnect(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private onConnect(ws: WebSocket): void {
    const clientId = `c${this.nextClient++}`;
    this.conns.set(ws, clientId);
    this.core.addPlayer(clientId);

    ws.addEventListener('message', (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) this.core.applyInput(clientId, ev.data);
    });
    const drop = () => this.onClose(ws);
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);

    this.ensureTicking();
  }

  private onClose(ws: WebSocket): void {
    const clientId = this.conns.get(ws);
    if (clientId === undefined) return;
    this.core.removePlayer(clientId);
    this.conns.delete(ws);
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
