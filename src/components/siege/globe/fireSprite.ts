// fireSprite — what makes fire look like fire instead of a pile of circles.
//
// Geoff: "we really now need better fire and explosions... they still look pathetically bad compared
// to how they should look to be more like fire. Can you find any webgl/three.js fire... better fire,
// more realistic? It can be cartoonish but not just a bunch of yellow circles."
//
// He is describing the exact failure, and naming it is most of the fix. The old flame was instanced
// SPHERES with a flat additive colour. A sphere drawn additively is a disc with a hard circular
// edge and no internal detail, so a thousand of them is a thousand visible circles however many you
// add — piling on more only makes the circles overlap.
//
// WHAT THE SEARCH TURNED UP. There is no official three.js fire example; it is an open feature
// request. The one good volumetric implementation (THREE.Fire) raymarches noise and needs the WebGPU
// renderer, which this project does not use. What everyone actually ships is the same recipe, and it
// is the one the community write-ups describe: a camera-facing QUAD per particle, a soft irregular
// mask rather than a disc, and a colour ramp that runs white-hot -> yellow -> orange -> deep red ->
// black smoke over the particle's life.
//
// So three things are wrong with a circle and all three are fixed here:
//
//   THE EDGE     fire has no outline. The mask is fractal noise, so every particle has a ragged,
//                wispy border and they blend into each other instead of stacking as discs.
//   THE INSIDE   fire is not flat. The same noise lights the interior, so there are bright veins
//                and dark gaps rather than one even blob.
//   THE COLOUR   a flame is a temperature gradient, not a colour. The ramp below is roughly what a
//                real one looks like on camera.
//
// Everything is generated into a canvas at startup — no asset to ship, 404 or cache-bust, and a
// missing texture in this scene would be an invisible effect with no error anywhere.

import * as THREE from 'three';

/** Value noise with smooth interpolation. Cheap, and tileable so the sprite has no seam. */
function makeNoise(size: number, seed: number): Float32Array {
  const g = new Float32Array(size * size);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return g;
}

function sampleNoise(g: Float32Array, size: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  // Smoothstep, so the field has no visible grid.
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const wrap = (n: number) => ((n % size) + size) % size;
  const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi), y1 = wrap(yi + 1);
  const a = g[y0 * size + x0], b = g[y0 * size + x1];
  const c = g[y1 * size + x0], d = g[y1 * size + x1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Several octaves of it. This is what gives fire its ragged, self-similar look. */
function fbm(g: Float32Array, size: number, x: number, y: number, octaves = 4): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * sampleNoise(g, size, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * One frame of a flame, as a soft irregular mask.
 *
 * `tall` stretches the mask upward and pinches its top, which is the difference between a puff and
 * a FLAME: a real one is taller than it is wide, is fat at the base and tapers to a lick.
 */
function drawCell(
  img: ImageData, ox: number, oy: number, cell: number, noise: Float32Array, nSize: number,
  seedX: number, tall: number,
): void {
  const half = cell / 2;
  for (let py = 0; py < cell; py++) {
    for (let px = 0; px < cell; px++) {
      // -1..1 across the cell.
      const nx = (px - half) / half;
      const ny = (py - half) / half;
      // Vertical taper: pinch toward the top so the shape licks upward.
      const up = (1 - ny) * 0.5;                       // 0 at top, 1 at bottom
      const pinch = 0.35 + 0.65 * Math.pow(up, 0.7);
      const rx = nx / Math.max(0.15, pinch);
      const ry = ny / tall;
      const r = Math.sqrt(rx * rx + ry * ry);

      // Fractal turbulence, sampled in the cell's own space and offset per frame so successive
      // frames are different flames rather than the same one moving.
      const n = fbm(noise, nSize, (px / cell) * 5 + seedX, (py / cell) * 5 - seedX * 0.7, 4);
      // Push the edge in and out by the noise. This is the whole trick: the silhouette is no longer
      // a circle, it is a torn edge that differs everywhere around the particle.
      const edge = r + (n - 0.5) * 1.15;
      let a = 1 - edge;
      a = Math.max(0, Math.min(1, a));
      a = a * a;                                        // soften the falloff
      // Light the interior with the same field, so there are veins and gaps instead of a flat blob.
      const core = Math.max(0, Math.min(1, (1 - r * 1.25) * (0.55 + 0.75 * n)));

      const o = ((oy + py) * img.width + (ox + px)) * 4;
      // RED = the mask (how much fire is here), GREEN = how HOT it is at this pixel.
      // Packing two fields into one texture means one sample in the shader rather than two.
      img.data[o] = Math.round(a * 255);
      img.data[o + 1] = Math.round(core * 255);
      img.data[o + 2] = 0;
      img.data[o + 3] = 255;
    }
  }
}

/** How many frames across and down the sheet. 4x4 gives sixteen distinct flames. */
export const FLIPBOOK = 4;

/**
 * A flipbook of flame masks.
 *
 * Sixteen frames, and each particle starts on a random one and advances through them over its life.
 * That is what stops a hundred particles reading as a hundred copies of one shape — the single
 * biggest tell of a cheap particle system, and the reason the old one looked like circles even after
 * more circles were added.
 */
export function fireSpriteSheet(cell = 128): THREE.Texture {
  const size = cell * FLIPBOOK;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const noise = makeNoise(64, 0x1EE7);
  for (let j = 0; j < FLIPBOOK; j++) {
    for (let i = 0; i < FLIPBOOK; i++) {
      drawCell(img, i * cell, j * cell, cell, noise, 64, (j * FLIPBOOK + i) * 3.7, 1.25);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  // NO mipmaps and clamped: a mipmapped flipbook bleeds neighbouring frames into each other at
  // distance, which shows up as ghostly squares around every particle.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The shader. Camera-facing quads, per-instance age/seed/size, and the temperature ramp.
 *
 * Billboarding is done in the VERTEX SHADER rather than by rewriting a matrix per particle on the
 * CPU: at fifteen hundred flame particles that is fifteen hundred matrix builds a frame, and it is
 * four lines of GLSL to do it for free on the GPU.
 */
export function fireMaterial(map: THREE.Texture, smoke: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uSmoke: { value: smoke ? 1 : 0 },
      uFlip: { value: FLIPBOOK },
    },
    transparent: true,
    depthWrite: false,
    // HOT FIRE ADDS, SMOKE DOES NOT. Additive is what makes overlapping flames build into a bright
    // core the way real fire does — but additive black is invisible, so smoke has to be drawn
    // normally or it simply would not exist.
    blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uFlip;
      attribute vec3 iPos;
      attribute vec4 iData;      // x: age 0..1, y: size, z: seed, w: kind (0 flame, 1 blast)
      varying vec2 vUv;
      varying float vAge;
      varying float vSeed;
      varying float vKind;

      void main() {
        vAge = iData.x;
        vSeed = iData.z;
        vKind = iData.w;

        // Pick a flipbook frame from the seed, then advance through the sheet over the life, so a
        // hundred particles are a hundred different flames rather than a hundred copies of one.
        float frames = uFlip * uFlip;
        float f = floor(mod(vSeed * frames + vAge * frames * 0.75, frames));
        vUv = (uv + vec2(mod(f, uFlip), floor(f / uFlip))) / uFlip;

        // Spin each particle at its own rate. Fire churns; a billboard that never rotates reads as
        // a decal stuck to the screen.
        float ang = (vSeed - 0.5) * 6.2831 + vAge * (vSeed - 0.5) * 3.0;
        float c = cos(ang), s = sin(ang);
        vec2 local = mat2(c, -s, s, c) * position.xy;

        // BILLBOARD IN THE VERTEX SHADER. Offsetting in VIEW space after the model-view transform
        // is what makes the quad face the camera, and it costs nothing — building fifteen hundred
        // look-at matrices on the CPU every frame would not.
        //
        // Grow as it burns: real fire expands as it cools and thins out. Explosion debris expands
        // far harder than a flame jet does.
        float grow = 1.0 + vAge * (vKind > 0.5 ? 2.6 : 1.4);
        vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
        mv.xy += local * iData.y * grow;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform float uSmoke;
      varying vec2 vUv;
      varying float vAge;
      varying float vSeed;
      varying float vKind;

      void main() {
        vec2 t = texture2D(uMap, vUv).rg;
        float mask = t.r;
        float core = t.g;
        if (mask < 0.02) discard;

        // THE TEMPERATURE RAMP. A flame is not a colour, it is a gradient over time: white-hot at
        // the source, yellow, orange, deep red, then nothing. Driven by age AND by the core field,
        // so the middle of a particle is hotter than its edges — which is what stops it reading as
        // a flat shape with a gradient painted on.
        float heat = clamp((1.0 - vAge) * (0.35 + 0.9 * core), 0.0, 1.0);
        vec3 col;
        if (uSmoke > 0.5) {
          // Cooling smoke: dark, and slightly warm while it still has any heat left in it.
          col = mix(vec3(0.05, 0.045, 0.05), vec3(0.30, 0.16, 0.10), heat * 0.8);
        } else {
          vec3 deepRed = vec3(1.0, 0.12, 0.02);
          vec3 orange  = vec3(1.0, 0.45, 0.06);
          vec3 yellow  = vec3(1.0, 0.85, 0.35);
          vec3 white   = vec3(1.0, 0.98, 0.90);
          col = mix(deepRed, orange, smoothstep(0.15, 0.45, heat));
          col = mix(col, yellow, smoothstep(0.45, 0.72, heat));
          col = mix(col, white, smoothstep(0.78, 1.0, heat));
        }

        // Fade in fast, out slowly, and eat the mask away as it dies so it DISSOLVES rather than
        // dimming — a particle that fades uniformly keeps its silhouette to the end and that is
        // what makes a fire look like stamped shapes.
        float born = smoothstep(0.0, 0.06, vAge);
        float dying = 1.0 - smoothstep(0.45, 1.0, vAge);
        float a = mask * born * dying;
        a *= smoothstep(0.0, 0.35, mask + (1.0 - vAge) - 0.55);
        if (uSmoke > 0.5) a *= 0.5 * smoothstep(0.25, 0.8, vAge);
        else a *= 0.9;
        if (a <= 0.003) discard;
        gl_FragColor = vec4(col * (uSmoke > 0.5 ? 1.0 : 1.0 + heat * 1.6), a);
      }
    `,
  });
}
