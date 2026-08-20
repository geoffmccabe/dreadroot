/**
 * netcode protocol — the typed message vocabulary between the GAME thread and
 * the netcode Web Worker. Pure (no DOM / Worker globals) so it can be imported
 * on both sides and unit-tested.
 *
 * Channel naming convention `world:<id>/zone:<id>` (works under any pub/sub
 * backend) is carried on the connect command.
 */
import type { SnapshotEntity } from '@/lib/snapshotBinary';

/** Which connection backend the worker should use. `synthetic` = an in-worker
 *  fake snapshot stream for dev/testing before the Durable Object exists. */
export type TransportKind = 'synthetic' | 'websocket';

// ── GAME → WORKER commands ──────────────────────────────────────────────────
export type NetCommand =
  | { kind: 'connect'; instanceId: string; token: string; transport: TransportKind; url?: string }
  | { kind: 'disconnect' }
  /** Client input bytes (movement / actions) to forward to the L2. Transferable. */
  | { kind: 'sendInput'; payload: ArrayBuffer };

// ── WORKER → GAME events ────────────────────────────────────────────────────
export type NetEvent =
  | {
      /** Server greeting: who we are, and which RUN of the server this is. */
      kind: 'hello';
      sessionId: number;
      yourEntityId: number;
      tick: number;
      tickRate: number;
      registryOrigin: number;
    }
  | { kind: 'connected'; instanceId: string }
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'error'; message: string }
  /** A decoded, diffed tick: only what changed since the worker's last snapshot. */
  | {
      kind: 'diff';
      tick: number;
      baseTick: number;
      /** Highest input sequence the server had applied for US. Drives
       *  reconciliation; 0 before any input has been acknowledged. */
      ackSeq: number;
      worldId: number;
      zoneId: number;
      added: SnapshotEntity[];
      changed: SnapshotEntity[];
      /** entity keys (see entityKey) that left the snapshot / AoI. */
      removed: number[];
    };
