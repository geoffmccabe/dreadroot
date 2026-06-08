/**
 * netcodeClient — the GAME-thread facade for the netcode worker. The ONLY
 * netcode surface game code touches: connect, send input, subscribe to decoded
 * snapshot diffs. It never sees the worker internals, the transport, or raw
 * bytes (those all live behind the worker).
 *
 * Like worldStore, this is the single allowed entry point for new client code
 * into the network layer.
 */
import type { NetCommand, NetEvent, TransportKind } from './protocol';

export type NetDiff = Extract<NetEvent, { kind: 'diff' }>;
export type NetStatus = Exclude<NetEvent, { kind: 'diff' }>;
type DiffHandler = (ev: NetDiff) => void;
type StatusHandler = (ev: NetStatus) => void;

class NetcodeClient {
  private worker: Worker | null = null;
  private diffHandlers = new Set<DiffHandler>();
  private statusHandlers = new Set<StatusHandler>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./netcodeWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<NetEvent>) => {
      const ev = e.data;
      if (ev.kind === 'diff') {
        for (const h of this.diffHandlers) h(ev);
      } else {
        for (const h of this.statusHandlers) h(ev);
      }
    };
    this.worker = w;
    return w;
  }

  /** Connect to an L2 instance. Defaults to the synthetic stream until a real
   *  Durable Object URL is available. */
  connectToInstance(
    instanceId: string,
    token: string,
    transport: TransportKind = 'synthetic',
    url?: string,
  ): void {
    this.post({ kind: 'connect', instanceId, token, transport, url });
  }

  disconnect(): void {
    this.post({ kind: 'disconnect' });
  }

  /** Forward client input bytes to the L2 (transferred, not copied). */
  sendInput(payload: ArrayBuffer): void {
    this.post({ kind: 'sendInput', payload }, [payload]);
  }

  /** Subscribe to per-tick decoded diffs. Returns an unsubscribe fn. */
  onDiff(cb: DiffHandler): () => void {
    this.diffHandlers.add(cb);
    return () => this.diffHandlers.delete(cb);
  }

  /** Subscribe to connection status (connected / disconnected / error). */
  onStatus(cb: StatusHandler): () => void {
    this.statusHandlers.add(cb);
    return () => this.statusHandlers.delete(cb);
  }

  dispose(): void {
    this.disconnect();
    this.worker?.terminate();
    this.worker = null;
  }

  private post(cmd: NetCommand, transfer: Transferable[] = []): void {
    this.ensureWorker().postMessage(cmd, transfer);
  }
}

/** Singleton facade — the game uses this. */
export const netcodeClient = new NetcodeClient();
