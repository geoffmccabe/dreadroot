/**
 * check-terrain-shader — every shader injection point still exists in three.js.
 *
 * terrainMaterial extends MeshStandardMaterial by string-replacing four #include markers in
 * three.js's own shader. A replace whose target is missing DOES NOTHING, silently: the build passes,
 * vite never looks inside a GLSL string, and the result is a shader referencing varyings that were
 * never declared. That fails in the browser and nowhere else, and it shows up as a black planet.
 *
 * It is also exactly the kind of thing a three.js upgrade breaks. Run: npm run check:terrain-shader
 */

// Does every string the terrain material replaces actually EXIST in three.js's standard shader?
// A .replace() whose target is missing does nothing, silently — and the result is a shader that
// references varyings nobody declared, which fails in the browser and nowhere else.
import * as THREE from 'three';
const std = THREE.ShaderLib.standard;
const targets = {
  vertex: ['#include <common>', '#include <project_vertex>'],
  fragment: ['#include <common>', '#include <normal_fragment_maps>', '#include <color_fragment>'],
};
let bad = 0;
for (const [which, list] of Object.entries(targets)) {
  const src = which === 'vertex' ? std.vertexShader : std.fragmentShader;
  for (const t of list) {
    const ok = src.includes(t);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${which}: ${t}`);
    if (!ok) bad++;
  }
}
// And resolve the includes to confirm the chunks the injections depend on define what we assume.
const resolve = (s) => s.replace(/#include <(\w+)>/g, (_, n) => THREE.ShaderChunk[n] ?? `/* MISSING ${n} */`);
const frag = resolve(std.fragmentShader);
for (const sym of ['roughnessFactor', 'diffuseColor', 'normal']) {
  const ok = frag.includes(sym);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  fragment defines ${sym}`);
  if (!ok) bad++;
}
const vert = resolve(std.vertexShader);
for (const sym of ['transformed', 'objectNormal', 'mvPosition']) {
  const ok = vert.includes(sym);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  vertex defines ${sym}`);
  if (!ok) bad++;
}
console.log(bad === 0 ? '\nALL INJECTION POINTS VALID' : `\n${bad} PROBLEM(S)`);
process.exit(bad ? 1 : 0);
