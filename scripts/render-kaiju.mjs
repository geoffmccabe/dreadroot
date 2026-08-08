// render-kaiju — draw a Kaiju's SKELETON through the game's exact pipeline, so a twisted leg is
// something to look at rather than something to argue about.
//
// Bones as lines, not a point cloud: a hip rotated ninety degrees is obvious as a stick figure and
// nearly invisible as a cloud of dots.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, SkeletonUtils } from 'three-stdlib';

const file = process.argv[2] || 'fortgolem';
const clipWant = process.argv[3] || 'walk';
const out = process.argv[4] || `/tmp/k_${file}.svg`;

/**
 * Re-pack a .glb with every image and texture removed.
 *
 * GLTFLoader decodes textures through the DOM, which does not exist here — it reaches for `self.URL`
 * and dies. This render only cares about bones, so the pixels are dropped before the loader ever
 * sees them. Geometry, skins and animations are untouched.
 */
function stripTextures(buf) {
  let off = 12, json = null, jsonRange = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) { json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8')); jsonRange = [off, len]; }
    if (type === 0x004e4942) bin = buf.subarray(off + 8, off + 8 + len);
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    for (const k of Object.keys(m)) if (/Texture$/.test(k)) delete m[k];
    const p = m.pbrMetallicRoughness;
    if (p) for (const k of Object.keys(p)) if (/Texture$/.test(k)) delete p[k];
  }
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
  let bn = bin ?? Buffer.alloc(0);
  while (bn.length % 4) bn = Buffer.concat([bn, Buffer.alloc(1)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + (bn.length ? 8 + bn.length : 0), 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bn.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return bn.length ? Buffer.concat([head, jh, js, bh, bn]) : Buffer.concat([head, jh, js]);
}

const raw = fs.readFileSync(`public/siege/monsters/${file}.glb`);
const b = stripTextures(raw);
const gltf = await new Promise((res, rej) =>
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej));

// EXACTLY what the game does: SkeletonUtils.clone, model scaled uniformly, inside a group.
const model = SkeletonUtils.clone(gltf.scene);
const group = new THREE.Group();
group.add(model);
const clip = gltf.animations.find(a => new RegExp(`^${clipWant}$`, 'i').test(a.name))
  || gltf.animations.find(a => new RegExp(clipWant, 'i').test(a.name));
if (!clip) { console.error('no clip', clipWant, '| have:', gltf.animations.map(a => a.name).join(', ')); process.exit(1); }
const mixer = new THREE.AnimationMixer(model);
mixer.clipAction(clip).play();
console.log(`${file} clip "${clip.name}" ${clip.duration.toFixed(2)}s`);

const bones = [];
// IK bones are rig plumbing — they sit at the origin or out at a target and skin nothing, so drawing
// them adds metre-long diagonals across the figure and hides the thing being looked for.
model.traverse(o => { if (o.isBone && !/^ik_|_ik$|ik_hand|ik_foot/i.test(o.name)) bones.push(o); });
// Legs are what is being complained about, so they are drawn hot and everything else cool.
const isLeg = (n) => /thigh|calf|leg|foot|ankle|knee|toe|ball/i.test(n);

// MESH mode draws the SKINNED VERTICES, not the bones. A shear distorts the skin while leaving
// every bone position perfect, so a stick figure cannot show it and this is the only view that can.
const MESH = process.env.MESH === '1';
let meshes = [];
if (MESH) model.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });

const PHASES = 5, W = 300, H = 420;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * PHASES}" height="${H * 2}" viewBox="0 0 ${W * PHASES} ${H * 2}"><rect width="100%" height="100%" fill="#161b22"/>`;

for (let p = 0; p < PHASES; p++) {
  mixer.setTime(0);
  mixer.update((clip.duration * p) / PHASES);
  group.updateMatrixWorld(true);

  let pts;
  if (MESH) {
    pts = [];
    const v = new THREE.Vector3();
    for (const m of meshes) {
      const n = m.geometry.attributes.position.count;
      const step = Math.max(1, Math.floor(n / 2200));
      for (let i = 0; i < n; i += step) { m.getVertexPosition(i, v); pts.push({ p: v.clone(), parent: null, leg: false }); }
    }
    // Colour the lower third hot, so a leg that goes wrong is the thing the eye lands on.
    const yb = new THREE.Box3(); for (const q of pts) yb.expandByPoint(q.p);
    const cut = yb.min.y + (yb.max.y - yb.min.y) * 0.45;
    for (const q of pts) q.leg = q.p.y < cut;
  } else {
    pts = bones.map(bn => ({
      p: new THREE.Vector3().setFromMatrixPosition(bn.matrixWorld),
      parent: bn.parent && bn.parent.isBone ? bn.parent : null,
      leg: isLeg(bn.name),
    }));
  }
  const box = new THREE.Box3();
  for (const q of pts) box.expandByPoint(q.p);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  const sc = (H * 0.78) / Math.max(1e-6, size.y);

  [['side', 2], ['front', 0]].forEach(([label, ax], row) => {
    const ox = p * W, oy = row * H;
    svg += `<text x="${ox + 8}" y="${oy + 16}" fill="#7fd" font-size="12" font-family="monospace">${label} t=${(p / PHASES).toFixed(2)}</text>`;
    for (const q of pts) {
      if (!q.parent) {
        if (!MESH) continue;
        const x = ox + W / 2 + (q.p[['x', 'y', 'z'][ax]] - ctr[['x', 'y', 'z'][ax]]) * sc;
        const y = oy + H * 0.9 - (q.p.y - box.min.y) * sc;
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.2" fill="${q.leg ? '#ff6a44' : '#6d9ec9'}"/>`;
        continue;
      }
      const pp = new THREE.Vector3().setFromMatrixPosition(q.parent.matrixWorld);
      const x1 = ox + W / 2 + (q.p[['x', 'y', 'z'][ax]] - ctr[['x', 'y', 'z'][ax]]) * sc;
      const y1 = oy + H * 0.9 - (q.p.y - box.min.y) * sc;
      const x2 = ox + W / 2 + (pp[['x', 'y', 'z'][ax]] - ctr[['x', 'y', 'z'][ax]]) * sc;
      const y2 = oy + H * 0.9 - (pp.y - box.min.y) * sc;
      const col = q.leg ? '#ff5a3c' : '#5a8fbf';
      svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="${q.leg ? 2.6 : 1.4}"/>`;
      svg += `<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="${q.leg ? 2.4 : 1.4}" fill="${col}"/>`;
    }
  });
}
svg += '</svg>';
fs.writeFileSync(out, svg);
console.log('wrote', out, `| ${bones.length} bones`);
