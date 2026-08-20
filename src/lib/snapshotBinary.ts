/**
 * snapshotBinary — the L2↔client world-snapshot wire format (Track 4B, built
 * pre-DO as the shared contract). Packs a tick's worth of entities into a
 * compact ArrayBuffer; the netcode worker (Track 0) decodes it off the main
 * thread and the L2 Durable Object will emit it.
 *
 * PURE: no React / Three.js / Supabase imports — it must run identically in the
 * client worker and the server DO (checked by check-chunk-portability.mjs).
 *
 * Forward-compatibility commitments from the architecture plan:
 *  • Coords are int32 fixed-point (1/16-block quantization) — NOT int16, so the
 *    ±32,768 cap can be lifted later (Track 7) without changing the on-disk
 *    format / hash.
 *  • Every entity carries a `registryOrigin` tag (0 = L1 today; an L2 instance
 *    index later) so nothing assumes "untagged = L1" (Track 8).
 *  • Plain numeric fields only; big ids stay within u32 for now (entity ids are
 *    per-origin, not global).
 *
 * NOTE: v1 encodes ABSOLUTE positions. Delta-against-previous-snapshot encoding
 * (for AoI bandwidth) is a Track 4 optimization layered on top — the format
 * carries a `baseTick` field so a future delta frame can reference its baseline
 * without a format change.
 */

export const SNAPSHOT_MAGIC = 0x44524b53; // 'DRKS'
export const SNAPSHOT_VERSION = 2;
/** Fixed-point scale: positions quantized to 1/16 of a block. */
export const POS_SCALE = 16;
/** Angle quantization: yaw mapped to a u16 (0..65535 ↔ 0..2π). Shared by the
 *  input + client-frame codecs too — one source of truth. */
const YAW_SCALE = 65536 / (Math.PI * 2);
const TWO_PI = Math.PI * 2;

/** Quantize a yaw (radians, any range) to a u16. */
export function quantizeYaw(yaw: number): number {
  let y = yaw % TWO_PI;
  if (y < 0) y += TWO_PI;
  return Math.round(y * YAW_SCALE) & 0xffff;
}

/** Decode a u16 back to a yaw in [0, 2π). */
export function dequantizeYaw(u16: number): number {
  return u16 / YAW_SCALE;
}

/** registryOrigin: 0 = canonical L1. >0 = an L2 instance (resolved via the
 *  snapshot's origin table later; reserved for Track 8). */
export const ORIGIN_L1 = 0;

export interface SnapshotEntity {
  /** registry origin tag (ORIGIN_L1 today). */
  registryOrigin: number;
  /** entity-type discriminator (player / shombie / shroomer / …) — small enum. */
  entityType: number;
  /** id within its origin (u32). */
  id: number;
  /** world position (block units; quantized to 1/16 on the wire). */
  x: number;
  y: number;
  z: number;
  /** facing yaw in radians (quantized to u16 on the wire). */
  yaw: number;
  /** packed per-type state flags (alive, anim phase, tier, …) — u16. */
  stateBits: number;
}

export interface Snapshot {
  /**
   * Highest client input sequence the server had APPLIED when this was built.
   *
   * Without this, client prediction and reconciliation cannot work at all:
   * `PredictedPlayer.reconcile()` needs to know which of its pending inputs
   * the server has already accounted for, or it replays inputs that are
   * already baked into the authoritative position and drifts further away
   * with every correction. The server computed this all along (ackSeqFor) and
   * simply never sent it.
   *
   * Per-recipient: each client is told about its OWN inputs.
   */
  ackSeq: number;
  /** authoritative L2 tick number this snapshot was produced on. */
  tick: number;
  /** the tick this is a delta against (== tick for a full/keyframe snapshot). */
  baseTick: number;
  worldId: number;
  zoneId: number;
  entities: SnapshotEntity[];
}

// Header: magic u32, version u8, flags u8, zoneId u16, tick u32, baseTick u32,
// worldId u32, entityCount u16.  = 22 bytes.
const HEADER_BYTES = 26;
// Per-entity: origin u8 + type u8 + id u32 + x/y/z int32 (12) + yaw u16 + state
// u16 = 22 bytes.
const ENTITY_BYTES = 22;

/** Quantize a block coordinate to the int32 fixed-point grid. */
function quantPos(v: number): number {
  // Round to nearest 1/POS_SCALE, store as int32. clamp to int32 range.
  const q = Math.round(v * POS_SCALE);
  return q | 0;
}

export function encodeSnapshot(snap: Snapshot): ArrayBuffer {
  const n = snap.entities.length;
  const buf = new ArrayBuffer(HEADER_BYTES + n * ENTITY_BYTES);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint32(o, SNAPSHOT_MAGIC); o += 4;
  dv.setUint8(o, SNAPSHOT_VERSION); o += 1;
  dv.setUint8(o, 0); o += 1; // flags (reserved)
  dv.setUint16(o, snap.zoneId & 0xffff); o += 2;
  dv.setUint32(o, snap.tick >>> 0); o += 4;
  dv.setUint32(o, snap.baseTick >>> 0); o += 4;
  dv.setUint32(o, snap.worldId >>> 0); o += 4;
  dv.setUint16(o, n & 0xffff); o += 2;
  dv.setUint32(o, (snap.ackSeq ?? 0) >>> 0); o += 4;

  for (let i = 0; i < n; i++) {
    const e = snap.entities[i];
    dv.setUint8(o, e.registryOrigin & 0xff); o += 1;
    dv.setUint8(o, e.entityType & 0xff); o += 1;
    dv.setUint32(o, e.id >>> 0); o += 4;
    dv.setInt32(o, quantPos(e.x)); o += 4;
    dv.setInt32(o, quantPos(e.y)); o += 4;
    dv.setInt32(o, quantPos(e.z)); o += 4;
    dv.setUint16(o, quantizeYaw(e.yaw)); o += 2;
    dv.setUint16(o, e.stateBits & 0xffff); o += 2;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot {
  const dv = new DataView(buf);
  let o = 0;
  const magic = dv.getUint32(o); o += 4;
  if (magic !== SNAPSHOT_MAGIC) throw new Error('snapshotBinary: bad magic');
  const version = dv.getUint8(o); o += 1;
  if (version !== SNAPSHOT_VERSION) throw new Error(`snapshotBinary: unsupported version ${version}`);
  o += 1; // flags
  const zoneId = dv.getUint16(o); o += 2;
  const tick = dv.getUint32(o); o += 4;
  const baseTick = dv.getUint32(o); o += 4;
  const worldId = dv.getUint32(o); o += 4;
  const n = dv.getUint16(o); o += 2;
  const ackSeq = dv.getUint32(o); o += 4;

  const entities: SnapshotEntity[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const registryOrigin = dv.getUint8(o); o += 1;
    const entityType = dv.getUint8(o); o += 1;
    const id = dv.getUint32(o); o += 4;
    const x = dv.getInt32(o) / POS_SCALE; o += 4;
    const y = dv.getInt32(o) / POS_SCALE; o += 4;
    const z = dv.getInt32(o) / POS_SCALE; o += 4;
    const yaw = dequantizeYaw(dv.getUint16(o)); o += 2;
    const stateBits = dv.getUint16(o); o += 2;
    entities[i] = { registryOrigin, entityType, id, x, y, z, yaw, stateBits };
  }
  return { tick, baseTick, worldId, zoneId, ackSeq, entities };
}
