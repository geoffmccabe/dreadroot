// Convert public/siege/scifi (the Extra library) into /tmp/r2-staging/siege/scifi:
//  - each X.gltf (+X.bin)  -> X.glb  (bin embedded; external .webp image URIs kept)
//  - .bin files            -> skipped (merged into glb)
//  - .webp / .json         -> copied as-is (shared texture atlases + sampler/catalog manifests)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const SRC = 'public/siege/scifi', OUT = '/tmp/r2-staging/siege/scifi';
mkdirSync(OUT, { recursive: true });
function pack(gltfPath, outPath) {
  const json = JSON.parse(readFileSync(gltfPath, 'utf8'));
  const bufs = json.buffers || [];
  if (bufs.length !== 1 || !bufs[0].uri || bufs[0].uri.startsWith('data:')) throw new Error('buffers=' + bufs.length);
  let bin = readFileSync(resolve(dirname(gltfPath), decodeURIComponent(bufs[0].uri)));
  delete json.buffers[0].uri; json.buffers[0].byteLength = bin.length;
  const pad = (b, p) => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), p)]) : b;
  let jb = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20); bin = pad(bin, 0x00);
  const total = 12 + 8 + jb.length + 8 + bin.length;
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jb.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  writeFileSync(outPath, Buffer.concat([h, jh, jb, bh, bin]));
}
let glb = 0, copied = 0, skipped = 0; const errors = [];
for (const f of readdirSync(SRC)) {
  if (f.endsWith('.gltf')) { try { pack(`${SRC}/${f}`, `${OUT}/${f.slice(0, -5)}.glb`); glb++; } catch (e) { errors.push(`${f}: ${e.message}`); } }
  else if (f.endsWith('.bin')) skipped++;
  else { copyFileSync(`${SRC}/${f}`, `${OUT}/${f}`); copied++; }
}
writeFileSync('/tmp/r2-staging/_scifi_report.json', JSON.stringify({ glb, copied, skipped, errorCount: errors.length, errors: errors.slice(0, 20) }, null, 2));
console.log(`DONE glb=${glb} copied=${copied} skippedBin=${skipped} errors=${errors.length}`);
