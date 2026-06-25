// Dependency-free glTF(+single .bin)->.glb packer. Embeds the buffer as the GLB BIN chunk and
// drops buffers[0].uri; external image URIs (shared .webp atlases) are LEFT external on purpose
// (they resolve against the same R2 folder). Multi-buffer gltf is rejected (Synty exports are single-buffer).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
function pack(gltfPath, outPath) {
  const json = JSON.parse(readFileSync(gltfPath, 'utf8'));
  const bufs = json.buffers || [];
  if (bufs.length !== 1 || !bufs[0].uri || bufs[0].uri.startsWith('data:')) {
    throw new Error(`unsupported buffers (${bufs.length}, uri=${bufs[0]?.uri?.slice(0,16)})`);
  }
  const binPath = resolve(dirname(gltfPath), decodeURIComponent(bufs[0].uri));
  let bin = readFileSync(binPath);
  delete json.buffers[0].uri;             // becomes the GLB BIN chunk
  json.buffers[0].byteLength = bin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (b, p) => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), p)]) : b;
  jsonBuf = pad(jsonBuf, 0x20);           // pad JSON with spaces
  bin = pad(bin, 0x00);                   // pad BIN with zeros
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);   // "JSON"
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);        // "BIN\0"
  writeFileSync(outPath, Buffer.concat([head, jh, jsonBuf, bh, bin]));
  return { gltf: jsonBuf.length, bin: bin.length, total };
}
const [,, inp, outp] = process.argv;
console.log(JSON.stringify(pack(inp, outp)));
