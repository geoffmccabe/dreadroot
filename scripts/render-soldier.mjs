// render-soldier — draw the assembled soldier to an SVG so the rifle placement can be LOOKED at.
//
// Blind grip offsets are the classic way a weapon ends up through a character's head, so this poses
// the real model with the real merged geometry and projects it. Not pretty; just true.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, SkeletonUtils } from 'three-stdlib';
import { buildSoldierTemplate } from '../src/components/siege/globe/soldierMesh.ts';

const load = (p) => new Promise((res, rej) => {
  const b = fs.readFileSync(p);
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej);
});

const soldier = await load('public/siege/characters/soldier.glb');
const rifle = await load('public/siege/weapons/ak47.glb');
// Build it twice: the vertex-count difference tells us exactly which vertices are the rifle, so it
// can be drawn in a colour that stands out from a dark gun on a dark uniform.
const bodyOnly = buildSoldierTemplate(soldier.scene, soldier.animations, null);
const t = buildSoldierTemplate(soldier.scene, soldier.animations, rifle.scene);
if (!t || !bodyOnly) { console.error('template build FAILED'); process.exit(1); }
let bodyVerts = 0;
bodyOnly.root.traverse(o => { if (o.isSkinnedMesh) bodyVerts = o.geometry.attributes.position.count; });
console.log('height', t.height.toFixed(3), '| rifle', t.hasRifle ? 'attached' : 'MISSING');

const clipName = process.argv[2] || 'Idle_Gun';
const clip = soldier.animations.find(a => a.name.endsWith('|' + clipName)) || soldier.animations[0];
console.log('clip:', clip.name, '| duration', clip.duration.toFixed(2));
const mixer = new THREE.AnimationMixer(t.root);
mixer.clipAction(clip).play();
mixer.update(0.001);
t.root.updateMatrixWorld(true);

// Posed vertex positions, straight off the SkinnedMesh (three applies the bone transforms for us).
let mesh = null;
t.root.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
const pos = mesh.geometry.attributes.position;
const col = mesh.geometry.attributes.color;
const v = new THREE.Vector3();
const pts = [];
console.log('verts: body', bodyVerts, '| total', pos.count, '| rifle', pos.count - bodyVerts);
const step = Math.max(1, Math.floor(pos.count / 3000));
for (let i = 0; i < pos.count; i += step) {
  mesh.getVertexPosition(i, v);
  const isRifle = i >= bodyVerts;
  pts.push([v.x, v.y, v.z, isRifle ? 1 : col.getX(i) * 0.5 + 0.25,
            isRifle ? 0.2 : col.getY(i) * 0.5 + 0.25,
            isRifle ? 0.1 : col.getZ(i) * 0.5 + 0.25, isRifle]);
}
// Rifle vertices are drawn last and larger, so they cannot be hidden behind the body.
pts.sort((a, b) => (a[6] ? 1 : 0) - (b[6] ? 1 : 0));
const H = t.height;
const views = [
  { name: 'side',  ax: 2, ay: 1, flip: 1 },
  { name: 'front', ax: 0, ay: 1, flip: 1 },
];
const W = 340, HT = 460;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * views.length}" height="${HT}" viewBox="0 0 ${W * views.length} ${HT}"><rect width="100%" height="100%" fill="#20262e"/>`;
views.forEach((view, vi) => {
  const ox = vi * W;
  const sc = (HT * 0.8) / H;
  svg += `<text x="${ox + 10}" y="20" fill="#9fb" font-size="14" font-family="monospace">${view.name} — ${clipName}</text>`;
  for (const p of pts) {
    const x = ox + W / 2 + p[view.ax] * sc * view.flip;
    const y = HT * 0.92 - p[view.ay] * sc;
    const c = `rgb(${Math.round(p[3] * 255)},${Math.round(p[4] * 255)},${Math.round(p[5] * 255)})`;
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${p[6] ? 2.4 : 1.4}" fill="${c}"/>`;
  }
});
svg += '</svg>';
fs.writeFileSync(process.argv[3] || '/tmp/soldier.svg', svg);
console.log('wrote', process.argv[3] || '/tmp/soldier.svg', `| ${pts.length} points`);

// --- MEASUREMENTS, so a wrong rifle is a number rather than an impression --------------------
{
  const bodyBox = new THREE.Box3(), gunBox = new THREE.Box3();
  const w = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    mesh.getVertexPosition(i, w);
    (i < bodyVerts ? bodyBox : gunBox).expandByPoint(w);
  }
  const bs = bodyBox.getSize(new THREE.Vector3());
  const gs = gunBox.getSize(new THREE.Vector3());
  console.log('POSED body size:', bs.toArray().map(v => v.toFixed(3)).join(' x '));
  console.log('POSED gun  size:', gs.toArray().map(v => v.toFixed(4)).join(' x '),
    '| longest', Math.max(gs.x, gs.y, gs.z).toFixed(4),
    '| wanted', (bs.y * 0.49).toFixed(3));
  console.log('gun centre     :', gunBox.getCenter(new THREE.Vector3()).toArray().map(v => v.toFixed(3)).join(', '));

  // WHICH END IS FORWARD. The thin end of a gun is the muzzle, so the thin end has to be the end
  // furthest out in front of the soldier. Reported as a number because "it looks right" is exactly
  // what missed the weapon being back to front the first time.
  const gv = [];
  for (let i = bodyVerts; i < pos.count; i++) { mesh.getVertexPosition(i, w); gv.push(w.clone()); }
  if (gv.length) {
    const ax = new THREE.Vector3().subVectors(
      gv.reduce((m, p) => (p.z > m.z ? p : m), gv[0]),
      gv.reduce((m, p) => (p.z < m.z ? p : m), gv[0]),
    ).normalize();
    const proj = gv.map((p) => p.dot(ax));
    const lo = Math.min(...proj), hi = Math.max(...proj), len = hi - lo;
    const thick = (from, to) => {
      const b = new THREE.Box3();
      gv.forEach((p, i) => { const t = (proj[i] - lo) / len; if (t >= from && t <= to) b.expandByPoint(p); });
      const s2 = b.getSize(new THREE.Vector3());
      return s2.y * s2.x;
    };
    const rear = thick(0, 0.17), front = thick(0.83, 1);
    console.log(`ends: rear area ${rear.toFixed(4)}  front area ${front.toFixed(4)}  ->`,
      front < rear ? 'MUZZLE FORWARD (correct)' : 'STOCK FORWARD (gun is backwards)');
  }
}
