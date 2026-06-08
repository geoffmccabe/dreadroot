/**
 * clientFrames — the client→L2 message envelope. A 1-byte type tag lets one
 * WebSocket carry two kinds of message:
 *   • INPUT (Track 4D, full authority): movement intent the server simulates.
 *   • STATE (presence): the client's own position, which the server stores and
 *     relays so others can see it. Client-trusted for now; replaced by INPUT
 *     once the movement physics is ported to the server.
 *
 * PURE / portable (client + worker). Relative imports so the worker bundle
 * resolves with no alias config.
 */
import { encodeInput, decodeInput, INPUT_BYTES } from './inputBinary';
import { POS_SCALE } from '../../lib/snapshotBinary';
import type { PlayerInputCmd } from './playerSim';

export const FRAME_INPUT = 1;
export const FRAME_STATE = 2;

const STATE_BYTES = 18; // seq u32 + x/y/z int32(×POS_SCALE) + yaw u16
const YAW_SCALE = 65536 / (Math.PI * 2);

export interface StateReport {
  seq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function encodeInputFrame(cmd: PlayerInputCmd): ArrayBuffer {
  const body = new Uint8Array(encodeInput(cmd));
  const out = new Uint8Array(1 + body.length);
  out[0] = FRAME_INPUT;
  out.set(body, 1);
  return out.buffer;
}

export function encodeStateFrame(s: StateReport): ArrayBuffer {
  const buf = new ArrayBuffer(1 + STATE_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, FRAME_STATE);
  dv.setUint32(1, s.seq >>> 0);
  dv.setInt32(5, Math.round(s.x * POS_SCALE));
  dv.setInt32(9, Math.round(s.y * POS_SCALE));
  dv.setInt32(13, Math.round(s.z * POS_SCALE));
  let yaw = s.yaw % (Math.PI * 2);
  if (yaw < 0) yaw += Math.PI * 2;
  dv.setUint16(17, Math.round(yaw * YAW_SCALE) & 0xffff);
  return buf;
}

export type DecodedFrame =
  | { kind: 'input'; cmd: PlayerInputCmd }
  | { kind: 'state'; state: StateReport }
  | { kind: 'unknown' };

export function decodeFrame(buf: ArrayBuffer): DecodedFrame {
  if (buf.byteLength < 1) return { kind: 'unknown' };
  const dv = new DataView(buf);
  const type = dv.getUint8(0);
  if (type === FRAME_INPUT && buf.byteLength >= 1 + INPUT_BYTES) {
    return { kind: 'input', cmd: decodeInput(buf.slice(1)) };
  }
  if (type === FRAME_STATE && buf.byteLength >= 1 + STATE_BYTES) {
    return {
      kind: 'state',
      state: {
        seq: dv.getUint32(1),
        x: dv.getInt32(5) / POS_SCALE,
        y: dv.getInt32(9) / POS_SCALE,
        z: dv.getInt32(13) / POS_SCALE,
        yaw: dv.getUint16(17) / YAW_SCALE,
      },
    };
  }
  return { kind: 'unknown' };
}
