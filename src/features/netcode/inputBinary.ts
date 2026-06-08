/**
 * inputBinary — the client→L2 input wire format (the reverse of snapshotBinary).
 * The client encodes one PlayerInputCmd per frame it sends; the DO decodes it
 * and queues it for the next tick. PURE / portable (client + worker).
 *
 * 12 bytes: seq u32 · moveX i16 · moveZ i16 · yaw u16 · dtMs u16. moveX/Z are the
 * intended direction in [-1,1] quantized ×10000; yaw is a u16 angle.
 */
import type { PlayerInputCmd } from './playerSim';

export const INPUT_BYTES = 12;
const MOVE_SCALE = 10000;
const YAW_SCALE = 65536 / (Math.PI * 2);

function clampI16(v: number): number {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}

export function encodeInput(cmd: PlayerInputCmd): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const dv = new DataView(buf);
  dv.setUint32(0, cmd.seq >>> 0);
  dv.setInt16(4, clampI16(Math.round(cmd.moveX * MOVE_SCALE)));
  dv.setInt16(6, clampI16(Math.round(cmd.moveZ * MOVE_SCALE)));
  let yaw = cmd.yaw % (Math.PI * 2);
  if (yaw < 0) yaw += Math.PI * 2;
  dv.setUint16(8, Math.round(yaw * YAW_SCALE) & 0xffff);
  dv.setUint16(10, cmd.dtMs & 0xffff);
  return buf;
}

export function decodeInput(buf: ArrayBuffer): PlayerInputCmd {
  const dv = new DataView(buf);
  return {
    seq: dv.getUint32(0),
    moveX: dv.getInt16(4) / MOVE_SCALE,
    moveZ: dv.getInt16(6) / MOVE_SCALE,
    yaw: dv.getUint16(8) / YAW_SCALE,
    dtMs: dv.getUint16(10),
  };
}
