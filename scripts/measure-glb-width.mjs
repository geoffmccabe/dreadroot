// measure-glb-width — how wide is a creature IN THE POSE IT IS DRAWN IN?
//
// The arena separates Kaiju with a vertical capsule whose radius is 0.25 x height. Whether that is
// right depends on how wide the body actually is, and the bind-pose bounding box does NOT answer
// that: a rigged humanoid is authored in a T-pose, so its box is the ARM SPAN, about 1.4 x height.
// Reading that number as body width says every model is too wide for its collider, which is wrong
// and would send the next fix in the wrong direction. (It nearly sent this one.)
//
// So this evaluates the animation instead. It walks the node hierarchy at real times in the idle
// and walk clips and measures how far the BONES get from the body's vertical axis. No skinning and
// no vertex data: bone reach is what decides whether the arms are out or down, and the mesh only
// wraps them.
//
// Run: node scripts/measure-glb-width.mjs [file.glb ...]

import { readFileSync } from 'node:fs';

const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a .glb`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error(`${path} has no JSON chunk`);
  return { json: json, bin: bin };
}

/** Read an accessor into a plain array of numbers. Sparse accessors are not used by these models. */
function readAccessor(g, bin, index) {
  const acc = g.accessors[index];
  const view = g.bufferViews[acc.bufferView];
  const Type = TYPED[acc.componentType];
  const n = COMP[acc.type];
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float32Array(acc.count * n);
  // byteStride only matters for interleaved vertex data; animation data is always tightly packed.
  const src = new Type(bin.buffer, bin.byteOffset + start, acc.count * n);
  for (let i = 0; i < out.length; i++) out[i] = src[i];
  return { data: out, n: n, count: acc.count };
}

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

function trs(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Sample an animation channel at time t. STEP and CUBICSPLINE fall back to nearest/linear. */
function sampleChannel(times, values, n, t, interp) {
  const last = times.count - 1;
  if (t <= times.data[0]) return values.data.slice(0, n);
  if (t >= times.data[last]) return values.data.slice(last * n, last * n + n);
  let i = 0;
  while (i < last && times.data[i + 1] < t) i++;
  const t0 = times.data[i], t1 = times.data[i + 1];
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  // CUBICSPLINE stores in-tangent, value, out-tangent per key; the value is the middle third.
  const stride = interp === 'CUBICSPLINE' ? n * 3 : n;
  const o0 = interp === 'CUBICSPLINE' ? i * stride + n : i * stride;
  const o1 = interp === 'CUBICSPLINE' ? (i + 1) * stride + n : (i + 1) * stride;
  const out = new Array(n);
  if (interp === 'STEP') { for (let k = 0; k < n; k++) out[k] = values.data[o0 + k]; return out; }
  if (n === 4) {
    // Quaternion: shortest-arc linear blend, renormalised. Good enough to locate a limb.
    let d = 0;
    for (let k = 0; k < 4; k++) d += values.data[o0 + k] * values.data[o1 + k];
    const sign = d < 0 ? -1 : 1;
    let len = 0;
    for (let k = 0; k < 4; k++) {
      out[k] = values.data[o0 + k] * (1 - u) + values.data[o1 + k] * sign * u;
      len += out[k] * out[k];
    }
    len = Math.sqrt(len) || 1;
    for (let k = 0; k < 4; k++) out[k] /= len;
    return out;
  }
  for (let k = 0; k < n; k++) out[k] = values.data[o0 + k] * (1 - u) + values.data[o1 + k] * u;
  return out;
}

function measure(path) {
  const { json: g, bin } = readGlb(path);
  if (!bin) return null;

  const clips = (g.animations ?? []).map((a) => a.name ?? '');
  const wanted = ['idle', 'breathidle', 'walk', 'walking', 'run'];
  const pick = [];
  for (const w of wanted) {
    const i = clips.findIndex((c) => c.toLowerCase() === w);
    if (i >= 0) pick.push(i);
  }
  if (!pick.length && g.animations?.length) pick.push(0);

  const results = [];
  for (const ai of pick) {
    const anim = g.animations[ai];
    // Per-node overrides for this clip, resolved at each sample time.
    const chans = anim.channels.map((c) => {
      const s = anim.samplers[c.sampler];
      return {
        node: c.target.node,
        path: c.target.path,
        times: readAccessor(g, bin, s.input),
        values: readAccessor(g, bin, s.output),
        interp: s.interpolation ?? 'LINEAR',
      };
    }).filter((c) => c.node != null && c.path !== 'weights');

    const duration = chans.reduce((m, c) => Math.max(m, c.times.data[c.times.count - 1]), 0);

    let widest = 0;
    let torso = 0;
    let lowest = Infinity;
    let highest = -Infinity;
    const SAMPLES = 12;
    for (let s = 0; s < SAMPLES; s++) {
      const t = duration * (s / SAMPLES);
      const override = new Map();
      for (const c of chans) {
        const n = c.path === 'rotation' ? 4 : 3;
        if (!override.has(c.node)) override.set(c.node, {});
        override.get(c.node)[c.path] = sampleChannel(c.times, c.values, n, t, c.interp);
      }

      const pts = [];
      const visit = (index, parent) => {
        const node = g.nodes[index];
        const o = override.get(index) ?? {};
        const local = node.matrix && !o.translation && !o.rotation && !o.scale
          ? node.matrix.slice()
          : trs(
            o.translation ?? node.translation ?? [0, 0, 0],
            o.rotation ?? node.rotation ?? [0, 0, 0, 1],
            o.scale ?? node.scale ?? [1, 1, 1],
          );
        const world = mul(parent, local);
        pts.push([world[12], world[13], world[14]]);
        for (const c of node.children ?? []) visit(c, world);
      };
      for (const r of g.scenes?.[g.scene ?? 0]?.nodes ?? []) visit(r, IDENTITY);

      for (const p of pts) {
        lowest = Math.min(lowest, p[1]);
        highest = Math.max(highest, p[1]);
      }
      const h = highest - lowest;
      for (const p of pts) {
        const reach = Math.hypot(p[0], p[2]);
        widest = Math.max(widest, reach);
        // TORSO BAND: hips to shoulders, 40%-75% of the way up. Reach here is body width, whereas
        // reach anywhere is dominated by a hand swinging forward — which is silhouette, not bulk.
        // Two creatures whose arms pass near each other look fine; two whose CHESTS intersect do
        // not, and that is the distinction the collider has to make.
        const f = h > 1e-6 ? (p[1] - lowest) / h : 0;
        if (f > 0.40 && f < 0.75) torso = Math.max(torso, reach);
      }
    }
    results.push({ name: anim.name ?? `#${ai}`, widest, torso, height: highest - lowest });
  }
  return { clips, results };
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : [
  'public/siege/monsters/reddemon.glb',
  'public/siege/monsters/fortgolem.glb',
  'public/siege/monsters/elementalgolem.glb',
];

/** The arena's torso capsule radius, as a fraction of body height. */
const CAPSULE_FRAC = 0.25;

console.log('\n== Body width in the pose it is actually drawn in ==\n');
for (const f of files) {
  try {
    const m = measure(f);
    if (!m) { console.log(`${f}\n   no binary chunk\n`); continue; }
    console.log(f);
    console.log(`   clips: ${m.clips.join(', ') || '(none)'}`);
    for (const r of m.results) {
      const frac = r.height > 1e-6 ? r.widest / r.height : 0;
      const tf = r.height > 1e-6 ? r.torso / r.height : 0;
      console.log(`   "${r.name}": torso ${tf.toFixed(3)}, full reach ${frac.toFixed(3)} (x height)`
        + `   ${tf > CAPSULE_FRAC ? `<-- TORSO reaches past the ${CAPSULE_FRAC} capsule` : 'torso inside the capsule'}`);
    }
    console.log('');
  } catch (e) {
    console.log(`${f}\n   could not read: ${e.message}\n`);
  }
}
