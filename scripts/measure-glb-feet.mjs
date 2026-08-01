// measure-glb-feet — where is a model's origin relative to its own feet? MEASURED, not guessed.
//
// Two attempts at the sinking Kaiju went wrong in opposite directions because the model's real
// layout was assumed. This reads the .glb straight off disk and prints the number, so the question
// "is the origin at the feet, the hips, or the centre?" is answered by the file itself.
//
// It reads the glTF JSON chunk only — no three.js, no renderer, no browser. Every POSITION accessor
// carries its own min/max, so the bounding box is exact without touching a single vertex.
//
// Run: node scripts/measure-glb-feet.mjs [more.glb ...]

import { readFileSync } from 'node:fs';

/** Read the JSON chunk of a binary glTF. */
function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a .glb`);
  let off = 12;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) return JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  throw new Error(`${path} has no JSON chunk`);
}

/** 4x4 column-major multiply, matching three.js Matrix4 element order. */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function fromTrs(node) {
  if (node.matrix) return node.matrix.slice();
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function measure(path) {
  const g = readGlb(path);
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  // A SKINNED primitive's positions are in SKELETON space, so its own node transform must NOT be
  // applied — three.js does the same. Getting this wrong is exactly the class of error that made
  // the first two fixes worse than the bug.
  let skinned = 0;
  let rigid = 0;

  const visit = (index, parent) => {
    const node = g.nodes[index];
    const world = mul(parent, fromTrs(node));
    if (node.mesh != null) {
      const isSkinned = node.skin != null;
      if (isSkinned) skinned++; else rigid++;
      const m = isSkinned ? IDENTITY : world;
      for (const prim of g.meshes[node.mesh].primitives ?? []) {
        const acc = g.accessors?.[prim.attributes?.POSITION];
        if (!acc?.min || !acc?.max) continue;
        // Transform all eight corners: a rotation makes the axis-aligned box of the transformed
        // corners the correct answer, while transforming min/max alone is not.
        for (let i = 0; i < 8; i++) {
          const p = apply(m, [
            i & 1 ? acc.max[0] : acc.min[0],
            i & 2 ? acc.max[1] : acc.min[1],
            i & 4 ? acc.max[2] : acc.min[2],
          ]);
          for (let k = 0; k < 3; k++) {
            if (p[k] < box.min[k]) box.min[k] = p[k];
            if (p[k] > box.max[k]) box.max[k] = p[k];
          }
        }
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  for (const s of g.scenes?.[g.scene ?? 0]?.nodes ?? []) visit(s, IDENTITY);

  return { box, skinned, rigid };
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
    'public/siege/monsters/fortgolem.glb',      // the player's Kaiju (catalog type 17)
    'public/siege/monsters/reddemon.glb',       // the opponents, and the crowd
    'public/siege/monsters/elementalgolem.glb',
    'public/siege/monsters/mechanicalgolem.glb',
    'public/siege/monsters/barbariangiant.glb',
  ];

console.log('\n== Model origin vs feet, read from the file ==\n');
for (const f of files) {
  try {
    const { box, skinned, rigid } = measure(f);
    const height = box.max[1] - box.min[1];
    const lift = -box.min[1];
    // What fraction of the body ends up underground if the origin is placed at ground level.
    const sunk = height > 1e-6 ? Math.max(0, lift) / height : 0;
    console.log(`${f}`);
    console.log(`   bounds y   ${box.min[1].toFixed(4)} .. ${box.max[1].toFixed(4)}   height ${height.toFixed(4)}`);
    console.log(`   foot lift  ${lift.toFixed(4)}  =  ${(sunk * 100).toFixed(1)}% of the body below its own origin`);
    console.log(`   meshes     ${skinned} skinned, ${rigid} rigid`);
    console.log(`   verdict    ${
      Math.abs(lift) < height * 0.02 ? 'ORIGIN AT THE FEET — no lift needed'
        : lift > 0 ? 'origin ABOVE the feet — must be lifted or it sinks'
          : 'origin BELOW the feet — would float'}\n`);
  } catch (e) {
    console.log(`${f}\n   could not read: ${e.message}\n`);
  }
}
