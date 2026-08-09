/**
 * check-terrain-shader — the injections exist, AND they are in the right order.
 *
 * terrainMaterial extends MeshStandardMaterial by string-replacing #include markers in three.js's
 * own shader. Two ways that goes silently wrong, and this project has now hit both:
 *
 *   MISSING TARGET   A .replace() whose target is not in the source does NOTHING. The build passes
 *                    — vite never looks inside a GLSL string — and the shader ends up referencing
 *                    varyings nobody declared.
 *   WRONG ORDER      The chunks run in a fixed sequence. Writing a variable in a chunk that runs
 *                    BEFORE the one declaring it is a compile error; reading a value computed in a
 *                    LATER chunk silently reads the initialiser. The first version did both:
 *                    roughnessFactor assigned four chunks before its declaration, and the colour
 *                    pass reading noise sampled seven chunks later.
 *
 * Neither surfaces at runtime either, because this project sets gl.debug.checkShaderErrors = false
 * (getProgramInfoLog was costing 1.6s of main-thread stalls per 48s). A failed shader throws
 * nothing and draws nothing. The planet simply is not there, with no error anywhere to look at.
 *
 * Run: npm run check:terrain-shader
 */

import * as THREE from 'three';
import { readFileSync } from 'node:fs';

let bad = 0;
const ok = (cond, label, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) bad++;
};

console.log('\n== Terrain shader injections ==\n');

const std = THREE.ShaderLib.standard;
const src = readFileSync('src/components/siege/globe/terrainMaterial.ts', 'utf8');

/** Every marker the material actually replaces, read from the source rather than duplicated here. */
const used = [...src.matchAll(/\.replace\('#include <(\w+)>'/g)].map((m) => m[1]);
ok(used.length >= 5, 'the material injects into several chunks', used.join(', '));

const vOrder = [...std.vertexShader.matchAll(/#include <(\w+)>/g)].map((m) => m[1]);
const fOrder = [...std.fragmentShader.matchAll(/#include <(\w+)>/g)].map((m) => m[1]);
for (const name of new Set(used)) {
  ok(vOrder.includes(name) || fOrder.includes(name),
     `three.js still has <${name}>`, 'a missing target replaces nothing, silently');
}

// THE ORDERING RULES. Each is a real failure this has already produced.
const at = (n) => fOrder.indexOf(n);
ok(at('color_fragment') < at('roughnessmap_fragment'),
   'roughnessFactor is declared AFTER color_fragment',
   `so it must be written in roughnessmap_fragment or later, not in color_fragment`);
ok(src.includes(".replace('#include <roughnessmap_fragment>'") || !src.includes('roughnessFactor ='),
   'roughness is written in the chunk that declares it');
ok(at('color_fragment') < at('normal_fragment_maps'),
   'color_fragment runs BEFORE normal_fragment_maps',
   'so shared samples must be taken in color_fragment, not the other way round');

// The shared globals must be assigned in the EARLIEST chunk that uses them.
const colourBlock = src.slice(src.indexOf("'#include <color_fragment>'"), src.indexOf("'#include <roughnessmap_fragment>'"));
for (const g of ['gWp', 'gWn', 'gCliff', 'gD', 'gDetail']) {
  ok(colourBlock.includes(`${g} =`) || colourBlock.includes(`${g} = `),
     `${g} is computed in color_fragment`, 'the earliest chunk that reads it');
}

// And the varyings the fragment shader reads must be written by the vertex shader.
const vertBlock = src.slice(0, src.indexOf('shader.fragmentShader'));
for (const v of ['vWorldPos', 'vWorldNrm', 'vViewPos']) {
  ok(vertBlock.includes(`${v} =`), `${v} is assigned in the vertex shader`);
  ok(src.includes(`varying vec3 ${v};`), `${v} is declared`);
}

// The chunks the injections lean on must still define what they are assumed to.
const resolve = (s) => s.replace(/#include <(\w+)>/g, (_, n) => THREE.ShaderChunk[n] ?? `/* MISSING ${n} */`);
const frag = resolve(std.fragmentShader);
const vert = resolve(std.vertexShader);
for (const sym of ['float roughnessFactor', 'vec4 diffuseColor']) {
  ok(frag.includes(sym), `fragment still declares ${sym}`);
}
for (const sym of ['transformed', 'objectNormal', 'mvPosition']) {
  ok(vert.includes(sym), `vertex still defines ${sym}`);
}

console.log(`\n${bad === 0 ? 'TERRAIN SHADER CHECKS PASSED' : `${bad} CHECK(S) FAILED`}\n`);
process.exit(bad ? 1 : 0);
