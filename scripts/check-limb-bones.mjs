// check-limb-bones — do the limb-collider bone names actually EXIST in the models?
//
// kaijuColliders.ts matches bones by name fragment to build a head, two arms and two legs. Those
// fragments were written from memory of how Synty and Mixamo name things, and NOTHING has ever
// checked them against a real file — which is how the whole limb system came to be dead code that
// nobody noticed for weeks. A missing bone is skipped silently by design, so a table that matches
// nothing produces a Kaiju with no limbs, no error, and no way to tell from inside the game.
//
// This reads each .glb's node list straight out of its JSON chunk and reports, per model, which
// limbs would be found and which would silently vanish. Bullet impacts land on these capsules, so
// a limb that is not found is a hole in the creature.
//
// Run: node scripts/check-limb-bones.mjs

import { readFileSync } from 'node:fs';

/** MUST stay in step with LIMB_BONES in src/components/siege/globe/kaijuColliders.ts. */
const LIMB_BONES = [
  { part: 'head', from: ['neck'], to: ['head'] },
  { part: 'armL', from: ['upperarm_l', 'leftarm', 'shoulder_l'], to: ['hand_l', 'lefthand'] },
  { part: 'armR', from: ['upperarm_r', 'rightarm', 'shoulder_r'], to: ['hand_r', 'righthand'] },
  { part: 'legL', from: ['upperleg_l', 'leftupleg', 'thigh_l'], to: ['foot_l', 'leftfoot'] },
  { part: 'legR', from: ['upperleg_r', 'rightupleg', 'thigh_r'], to: ['foot_r', 'rightfoot'] },
];

const MODELS = [
  'public/siege/monsters/reddemon.glb',
  'public/siege/monsters/fortgolem.glb',
  'public/siege/monsters/elementalgolem.glb',
  'public/siege/monsters/mechanicalgolem.glb',
];

/** Node names out of a .glb's JSON chunk. Skin joints are node indices, so names are enough. */
function nodeNames(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a glb`);
  let off = 12;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) {
      const json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
      // Only JOINTS, not every node: matching against decorative meshes would report a limb found
      // where the collider will find nothing, which is worse than reporting it missing.
      const joints = new Set();
      for (const s of json.skins ?? []) for (const j of s.joints ?? []) joints.add(j);
      const names = [];
      (json.nodes ?? []).forEach((n, i) => { if (joints.has(i) && n.name) names.push(n.name); });
      return names.length ? names : (json.nodes ?? []).map((n) => n.name ?? '');
    }
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return [];
}

let failures = 0;
console.log('\n== Limb colliders: do the bones exist? ==\n');

for (const path of MODELS) {
  let names;
  try { names = nodeNames(path).map((n) => n.toLowerCase()); }
  catch (e) { console.log(`  SKIP  ${path} (${e.message})`); continue; }

  const find = (frags) => {
    for (const f of frags) { const hit = names.find((n) => n.includes(f)); if (hit) return hit; }
    return null;
  };

  const found = [];
  const missing = [];
  for (const l of LIMB_BONES) {
    const a = find(l.from), b = find(l.to);
    if (a && b) found.push(`${l.part}(${a}->${b})`); else missing.push(l.part);
  }
  const name = path.split('/').pop();
  console.log(`  ${missing.length === 0 ? 'PASS' : 'FAIL'}  ${name}: ${found.length}/5 limbs`);
  for (const f of found) console.log(`          ${f}`);
  if (missing.length) {
    console.log(`          MISSING: ${missing.join(', ')} — bullets pass through these`);
    failures++;
  }
}

console.log(`\n${failures === 0 ? 'ALL MODELS HAVE FULL LIMB COLLIDERS' : `${failures} MODEL(S) INCOMPLETE`}\n`);
process.exit(failures === 0 ? 0 : 1);
