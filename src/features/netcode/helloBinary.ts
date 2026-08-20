/**
 * The server's opening message: "here is who you are, and which run of the
 * server you are talking to".
 *
 * Two structural gaps this closes, both found in audit:
 *
 * 1. THE CLIENT NEVER KNEW WHICH ENTITY WAS ITS OWN. The server assigns an
 *    entity id on join and then discarded it. Without that id a client cannot
 *    pick itself out of a snapshot, which makes reconciliation impossible and
 *    makes it impossible to even COMPARE the server's idea of where you are
 *    against your own. Everything in stage 4 depends on this.
 *
 * 2. A SERVER RESTART STALLED EVERY CLIENT FOREVER. The client drops any
 *    snapshot whose tick is not newer than the last one it saw. A Durable
 *    Object eviction resets the tick counter to zero, so every subsequent
 *    snapshot was discarded permanently — no timeout, no resync, no error.
 *    Cloudflare resets every live object on each code deploy, so this was not
 *    an edge case; it was guaranteed on every deploy. The sessionId changes
 *    whenever the server restarts, which lets the client tell "this stream
 *    went backwards because it is a NEW server" apart from "this packet is
 *    out of order", and resync instead of hanging.
 *
 * Sent as its own frame with a distinct magic, so the existing snapshot codec
 * is untouched and the receiver can dispatch on the first four bytes.
 */

export const HELLO_MAGIC = 0x44524b48; // 'DRKH'
export const HELLO_VERSION = 1;
export const HELLO_BYTES = 22;

export interface Hello {
  /** Wire version. A mismatch means one side is stale; fail loudly. */
  version: number;
  /** Identifies THIS RUN of the server. Changes on restart/eviction/deploy. */
  sessionId: number;
  /** The entity id assigned to the receiving client. */
  yourEntityId: number;
  /** Server tick at the moment of greeting. */
  tick: number;
  /** Server simulation rate, ticks per second. */
  tickRate: number;
  /** Registry origin for this server's entities (forward-compat, Track 8). */
  registryOrigin: number;
}

export function encodeHello(h: Hello): ArrayBuffer {
  const buf = new ArrayBuffer(HELLO_BYTES);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint32(o, HELLO_MAGIC); o += 4;
  dv.setUint8(o, h.version); o += 1;
  dv.setUint8(o, h.registryOrigin); o += 1;
  dv.setUint32(o, h.sessionId >>> 0); o += 4;
  dv.setUint32(o, h.yourEntityId >>> 0); o += 4;
  dv.setUint32(o, h.tick >>> 0); o += 4;
  dv.setUint16(o, h.tickRate); o += 2;
  dv.setUint16(o, 0); o += 2; // reserved
  return buf;
}

/** True if this buffer is a hello frame. Cheap peek, no allocation. */
export function isHello(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  return new DataView(buf).getUint32(0) === HELLO_MAGIC;
}

export function decodeHello(buf: ArrayBuffer): Hello {
  if (buf.byteLength < HELLO_BYTES) {
    throw new Error(`hello too short: ${buf.byteLength} < ${HELLO_BYTES}`);
  }
  const dv = new DataView(buf);
  let o = 0;
  const magic = dv.getUint32(o); o += 4;
  if (magic !== HELLO_MAGIC) throw new Error(`bad hello magic: ${magic.toString(16)}`);
  const version = dv.getUint8(o); o += 1;
  if (version !== HELLO_VERSION) throw new Error(`hello version ${version} != ${HELLO_VERSION}`);
  const registryOrigin = dv.getUint8(o); o += 1;
  const sessionId = dv.getUint32(o); o += 4;
  const yourEntityId = dv.getUint32(o); o += 4;
  const tick = dv.getUint32(o); o += 4;
  const tickRate = dv.getUint16(o); o += 2;
  return { version, registryOrigin, sessionId, yourEntityId, tick, tickRate };
}
