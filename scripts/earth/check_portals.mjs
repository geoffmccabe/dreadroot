// Geometry checks for the Mini Earth portal clusters.
//
// The spec is: 1 gate alone; 2 facing each other with ramps outward; 3 a triangle; 4 a plus;
// 5+ a pentagon, hexagon and so on, with the ring growing so a 15-node site is a large ring.
// All of those are one rule (a regular n-gon, gates facing the centre), so what needs proving is
// that gates never intersect, that every gate faces inward, and that ramps point outward.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transform } from 'esbuild';
import * as THREE from 'three';

const src = readFileSync('src/components/siege/globe/GlobePortals.tsx', 'utf8')
  // Strip the React/asset surface; we only want the pure geometry helpers.
  .replace(/^import .*$/gm, '')
  .replace(/export function GlobePortals[\s\S]*$/m, '')
  .replace(/useGLTF\.preload[\s\S]*$/m, '');
const { code } = await transform(
  `import * as THREE from 'three';\n` +
  `const ASSET_BASE='';\n` +
  `const PLANET_RADIUS=63710, METRES_PER_UNIT=100;\n` +
  `const latLonToDirection=(lat,lon,out)=>{const la=lat*Math.PI/180,lo=lon*Math.PI/180,c=Math.cos(la);out[0]=-c*Math.sin(lo);out[1]=Math.sin(la);out[2]=-c*Math.cos(lo);};\n` +
  `const sampleGlobeSurface=()=>0;\n` + src,
  { loader: 'tsx', format: 'esm' });

const tmp = 'scripts/earth/_portals.tmp.mjs';
writeFileSync(tmp, code);
let mod;
try { mod = await import('./_portals.tmp.mjs'); } finally { unlinkSync(tmp); }

let fails = 0;
const fail = (m) => { console.log('  FAIL ' + m); fails++; };
const GATE_H = 10, MODEL_H = 6.8294, MODEL_W = 8.3069;
const gateW = MODEL_W * (GATE_H / MODEL_H);
console.log(`gate: ${GATE_H} units tall (1,000 m), ${gateW.toFixed(1)} units wide\n`);

for (const n of [1, 2, 3, 4, 5, 6, 8, 12, 15, 24]) {
  const list = [];
  mod.buildSite({ id: 'x', lat: 32.78, lon: -96.80, city: 'Dallas', cc: 'US', nodes: n }, list);
  const R = mod.ringRadius(n);

  // Extract positions and the model's local +Z (facing) and -Z (ramp) directions.
  const pos = list.map((g) => new THREE.Vector3().setFromMatrixPosition(g.matrix));
  const fwd = list.map((g) => {
    const m = g.matrix.elements;
    return new THREE.Vector3(m[8], m[9], m[10]).normalize();   // basis Z column
  });
  const centre = list[0].site;

  // 1. right number of gates
  const expect = Math.min(24, Math.max(1, n));
  if (list.length !== expect) fail(`n=${n}: built ${list.length} gates, expected ${expect}`);

  // 2. no two gates intersect
  let minSep = Infinity;
  for (let i = 0; i < pos.length; i++)
    for (let j = i + 1; j < pos.length; j++)
      minSep = Math.min(minSep, pos[i].distanceTo(pos[j]));
  const sepOK = list.length < 2 || minSep > gateW;

  // 3. every gate faces the ring centre (its +Z points inward)
  let worstFacing = 1;
  for (let i = 0; i < pos.length && list.length > 1; i++) {
    const toCentre = centre.clone().sub(pos[i]).normalize();
    worstFacing = Math.min(worstFacing, fwd[i].dot(toCentre));
  }
  const faceOK = list.length < 2 || worstFacing > 0.99;

  // 4. gates stand upright: local +Y is the surface normal
  let worstUp = 1;
  for (const g of list) {
    const m = g.matrix.elements;
    const y = new THREE.Vector3(m[4], m[5], m[6]).normalize();
    const up = new THREE.Vector3().setFromMatrixPosition(g.matrix).normalize();
    worstUp = Math.min(worstUp, y.dot(up));
  }

  const ringKm = (R * 100 / 1000).toFixed(2);
  console.log(`n=${String(n).padStart(2)}  radius ${R.toFixed(1).padStart(6)} u (${ringKm} km)  `
    + `min sep ${(list.length < 2 ? 0 : minSep).toFixed(1).padStart(6)} u  `
    + `faces-in ${list.length < 2 ? 'n/a' : worstFacing.toFixed(4)}  upright ${worstUp.toFixed(4)}`);
  if (!sepOK) fail(`n=${n}: gates overlap (min separation ${minSep.toFixed(1)} < width ${gateW.toFixed(1)})`);
  if (!faceOK) fail(`n=${n}: a gate is not facing the ring centre (dot ${worstFacing.toFixed(3)})`);
  if (worstUp < 0.999) fail(`n=${n}: a gate is not upright (dot ${worstUp.toFixed(3)})`);
}

// The n=2 case must be two gates back to back: ramps (model -Z) pointing directly apart.
{
  const list = [];
  mod.buildSite({ id: 'x', lat: 0, lon: 0, city: null, cc: null, nodes: 2 }, list);
  const ramp = list.map((g) => {
    const m = g.matrix.elements;
    return new THREE.Vector3(-m[8], -m[9], -m[10]).normalize();
  });
  const opposed = ramp[0].dot(ramp[1]);
  console.log(`\nn=2 ramps point apart: dot = ${opposed.toFixed(4)} (-1.0 = exactly opposite)`);
  if (opposed > -0.99) fail(`n=2 ramps are not opposed (dot ${opposed.toFixed(3)})`);
}

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL PORTAL GEOMETRY CHECKS PASSED');
process.exit(fails ? 1 : 0);
