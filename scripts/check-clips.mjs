/**
 * Does every animation clip the code asks for actually EXIST?
 *
 * A missing clip fails SILENTLY: the mixer finds no action, plays nothing, and the
 * character just keeps doing what it was doing. The vault animation was referenced
 * without its `_NoSkin` suffix and so had never once played — not a visible error
 * anywhere, just a move that never happened.
 *
 * Reads the clip names out of the glb files directly and cross-references what
 * clipSets.ts asks for.
 *
 *   npm run check:clips
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB_DIR = path.join(ROOT, 'public/siege/characters');

const have = new Set();
for (const f of fs.readdirSync(GLB_DIR).filter((x) => x.endsWith('.glb'))) {
  const b = fs.readFileSync(path.join(GLB_DIR, f));
  if (b.length < 20) continue;
  const jsonLen = b.readUInt32LE(12);
  let json;
  try { json = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8')); } catch { continue; }
  for (const a of json.animations ?? []) have.add(a.name);
}

const src = fs.readFileSync(path.join(ROOT, 'src/features/characters/animation/clipSets.ts'), 'utf8');

// Root-rig clips are wrapped by R() into `Root|<name>|Animation Base Layer` at
// runtime, so the bare name in the source is not what is looked up. Check the
// decorated form for those, the literal for everything else.
const refs = new Map();   // name as looked up -> how it was written
for (const m of src.matchAll(/R\('([^']+)'\)/g)) refs.set(`Root|${m[1]}|Animation Base Layer`, `R('${m[1]}')`);
for (const m of src.matchAll(/'((?:Anim_|Climbing|pistol_|Loco_)[A-Za-z0-9_\-| ]{3,})'/g)) refs.set(m[1], m[1]);

const missing = [...refs.entries()].filter(([name]) => !have.has(name));

console.log(`\n=== CLIP CHECK ===`);
console.log(`clips in glbs   : ${have.size}`);
console.log(`clips referenced: ${refs.size}`);
if (missing.length === 0) {
  console.log('\nRESULT: every referenced clip exists.');
  process.exit(0);
}
console.log(`\nMISSING (${missing.length}) — these play NOTHING, silently:`);
for (const [name, written] of missing) {
  const near = [...have].find((h) => h.startsWith(name) || h.replace(/_NoSkin$/, '') === name)
    ?? [...have].find((h) => h.toLowerCase().includes(name.toLowerCase().slice(0, 18)));
  console.log(`  ${written}`);
  console.log(`      ${near ? `did you mean: ${near}` : 'no similar clip found'}`);
}
process.exit(1);
