// terrainMaterial — ground that catches light, from zero bytes of texture.
//
// Geoff: "all the grand canyon looks bad... soft and doesn't look good at all because it seems to
// have super blurry washed out textures."
//
// THERE ARE NO TEXTURES. That is the finding, and it changes what the fix is. GlobeTerrain says so
// itself: "There are no texture maps yet (that is the biome work in P3), so all of the visual
// variety has to come from per-vertex colour." So every surface is a colour computed per vertex
// from latitude, elevation and slope, then interpolated smoothly across triangles hundreds of
// metres wide. Nothing is blurry; there is simply nothing there to be sharp.
//
// It was also MeshLambertMaterial, which is the flattest surface three.js offers: pure diffuse, no
// specular, no roughness, no normals beyond the geometry's own. Even with a perfect sun, nothing
// could catch a highlight.
//
// WHAT P3 PLANS, AND WHY THIS IS THE SAME THING EARLY.
//
// The plan is to ship ESA WorldCover (a 10 m global land-class map, free) downsampled to about 1 km
// — single-digit megabytes for the whole planet, because class maps compress extremely well — plus
// NASA Blue Marble as a colour tint, and then SYNTHESISE the material in the shader from class,
// slope, altitude and latitude. Explicitly: "You do not store textures. You store a tiny map of
// what kind of place this is, and the shader synthesises the material from that."
//
// The terrain ALREADY computes a biome per vertex from latitude, elevation and slope. That is the
// same class signal, derived instead of measured. So the missing half of P3 is not the data — it is
// the synthesis, and the synthesis costs nothing to ship. Geoff: "I wanted to have something highly
// compressed and procedural so it would be very light." This is the limit case of that: zero bytes.
//
// FOUR THINGS ARE ADDED, in order of how much they matter:
//
//   NORMALS   Fractal noise perturbs the surface normal per pixel. This is the big one. It is what
//             makes light rake across a slope and pick out relief that the geometry does not have,
//             and it is the difference between rock and coloured plastic.
//   STRATA    Horizontal bands keyed to altitude, only on steep ground. Sedimentary layering is
//             what the Grand Canyon IS; without it a canyon wall is a brown ramp.
//   DETAIL    Albedo broken up at three scales so no surface is one flat tone.
//   ROUGHNESS Varied by slope and noise, so wet rock, dry sand and snow do not all shine alike.
//
// All of it is triplanar — driven by world position rather than UVs — because this geometry has no
// UVs at all, and because triplanar mapping has no seams and no stretching on cliffs, which is
// exactly where a planar projection falls apart.

import * as THREE from 'three';

/**
 * Metres per repeat of the coarsest detail octave.
 *
 * Three octaves an order of magnitude apart cover the whole range anyone will look from: 400 m
 * reads as terrain-scale variation from the air, 40 m as boulder field from a Kaiju's eyeline, 4 m
 * as grain when you walk a human up to a cliff. One frequency would be visibly tiled at one
 * distance and invisible at the others.
 */
const DETAIL_M_COARSE = 400;
const DETAIL_M_MID = 40;
const DETAIL_M_FINE = 4;

/** Thickness of one sedimentary band, in metres. Real canyon strata run tens of metres. */
const STRATA_M = 55;

/**
 * GLSL: value noise and fBm, in world space.
 *
 * Deliberately the cheap hash-and-smoothstep kind rather than gradient noise. At three octaves in
 * three projections that is a lot of samples per pixel, and the difference between value and
 * Perlin is invisible once it is only perturbing a normal.
 */
const NOISE_GLSL = /* glsl */`
  float tHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float tNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(tHash(i + vec3(0,0,0)), tHash(i + vec3(1,0,0)), f.x),
                   mix(tHash(i + vec3(0,1,0)), tHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(tHash(i + vec3(0,0,1)), tHash(i + vec3(1,0,1)), f.x),
                   mix(tHash(i + vec3(0,1,1)), tHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  // TWO OCTAVES, and the count matters more than it looks.
  //
  // This is full-screen terrain, so every sample here is paid for on every ground pixel. The first
  // draft ran four octaves through a three-plane triplanar blend in six places, which works out at
  // roughly a thousand hash evaluations per pixel — enough to halve the frame rate on its own, for
  // detail that is invisible under a second octave of the same field. Two octaves and shared
  // samples give the same read for about a fifth of the cost.
  float tFbm(vec3 p) {
    return tNoise(p) * 0.65 + tNoise(p * 2.03 + 7.1) * 0.35;
  }
`;

/**
 * Build the terrain material.
 *
 * A MeshStandardMaterial with its shader extended, rather than a material written from scratch:
 * that keeps three.js's own lighting, shadow receiving, fog and tone mapping — all of which are
 * things a hand-rolled shader would have to reimplement and would get subtly wrong.
 */
export function makeTerrainMaterial(metresPerUnit: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
    // FOG ON. It was off, which is why the planet has no aerial perspective — every ridge, near or
    // fifty kilometres away, arrives at full contrast, and the eye reads that as flat.
    fog: true,
    roughness: 0.95,
    metalness: 0.0,
    // Flat shading OFF but a strong normal perturbation below: the geometry is smooth by necessity
    // (it is a heightfield sampled every few hundred metres) and all the surface detail has to be
    // faked in the shader.
    flatShading: false,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMPU = { value: metresPerUnit };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldNrm;
        varying vec3 vViewPos;
      `)
      // INJECTED AT project_vertex, NOT worldpos_vertex.
      //
      // <worldpos_vertex> is CONDITIONAL — three.js only emits it when something in the material
      // actually needs a world position (an env map, fog, certain shadow paths). Attach to it and
      // the shader compiles or does not depending on flags set elsewhere, which is a failure that
      // appears as a black planet the day somebody turns fog off. <project_vertex> is always there.
      .replace('#include <project_vertex>', `#include <project_vertex>
        // The material needs WORLD position to sample the noise (it is triplanar, so it is driven by
        // position rather than by UVs, of which this geometry has none) and the world normal to tell
        // cliff from floor. Neither is among the standard varyings.
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldNrm = normalize(mat3(modelMatrix) * objectNormal);
        vViewPos = mvPosition.xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uMPU;
        varying vec3 vWorldPos;
        varying vec3 vWorldNrm;
        varying vec3 vViewPos;
        ${NOISE_GLSL}

        // Sampled once in the normal pass and reused in the colour pass. GLSL has no way to pass a
        // local between two injected chunks, so they are file-scope in the fragment shader.
        vec3  gWp = vec3(0.0);
        vec3  gWn = vec3(0.0, 1.0, 0.0);
        float gCliff = 0.0;
        float gDetail = 0.5;
        float gD = 0.5;
        float gCoarse = 0.5;
        float gFine = 0.5;
        float gFineAmt = 0.0;

        /** fBm sampled on all three axis planes and blended by the normal. No UVs, no seams. */
        float triFbm(vec3 wp, vec3 n, float scale) {
          vec3 b = abs(n); b /= max(1e-4, b.x + b.y + b.z);
          vec3 p = wp * scale;
          return tFbm(vec3(p.y, p.z, 0.0)) * b.x
               + tFbm(vec3(p.z, p.x, 0.0)) * b.y
               + tFbm(vec3(p.x, p.y, 0.0)) * b.z;
        }
      `)
      //
      // THE ORDER OF THESE THREE IS NOT A STYLE CHOICE, and getting it wrong is what black-screened
      // the planet. three.js runs its fragment chunks in a fixed sequence:
      //
      //     33  color_fragment          diffuseColor exists
      //     37  roughnessmap_fragment   roughnessFactor is DECLARED HERE
      //     40  normal_fragment_maps    `normal` exists
      //
      // The first version sampled the noise in normal_fragment_maps and used it in color_fragment —
      // which runs SEVEN CHUNKS EARLIER, so the colour pass read values that had not been computed
      // yet. And it assigned roughnessFactor from color_fragment, four chunks before that variable
      // is declared, which is a compile error. With gl.debug.checkShaderErrors off (this project
      // disables it: getProgramInfoLog was costing 1.6s of main-thread stalls per 48s) a failed
      // shader throws nothing and draws nothing. Hence: no terrain, no error, nowhere to look.
      //
      // So: sample once at color_fragment, use the results in the two later chunks.
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // WORLD SCALE. Everything below is written in metres and converted here, so the numbers in
          // this file mean what they say whatever the unit scale is.
          float mpu = max(1e-6, uMPU);
          vec3 wp = vWorldPos * mpu;                 // world position in METRES
          vec3 wn = normalize(vWorldNrm);
          gWp = wp;
          gWn = wn;
          gCliff = 1.0 - clamp(dot(wn, normalize(vWorldPos)), 0.0, 1.0);

          // DETAIL FADES WITH DISTANCE, and this is not only about cost.
          //
          // Noise finer than a pixel does not add detail, it adds SHIMMER: the field is re-sampled
          // at a slightly different point every frame as the camera moves, so a distant slope
          // crawls. A mipmap chain is what stops that happening to a real texture, and a procedural
          // material has to do the same job by hand. Fading the fine octave out past a few hundred
          // metres kills the crawl and gives the cost back where nobody could see the detail anyway.
          float viewM = length(vViewPos) * mpu;
          gFineAmt = 1.0 - smoothstep(220.0, 900.0, viewM);

          // ONE set of samples, used here AND by the two chunks below. Taking them twice was the
          // single biggest waste in the first version of this shader.
          gD = triFbm(wp, wn, 1.0 / ${DETAIL_M_MID}.0);
          gCoarse = triFbm(wp, wn, 1.0 / ${DETAIL_M_COARSE}.0);
          gFine = gFineAmt > 0.01 ? triFbm(wp, wn, 1.0 / ${DETAIL_M_FINE}.0) : 0.5;

          // DETAIL, three scales. Kept as a multiply around 1.0 so it darkens and lightens the
          // vertex colour rather than replacing it — the biome tint stays exactly as authored.
          float d = gCoarse * 0.5 + gD * 0.32 + mix(0.5, gFine, gFineAmt) * 0.18;
          gDetail = d;
          diffuseColor.rgb *= 0.74 + 0.52 * d;

          // STRATA. Horizontal bands by ALTITUDE, on steep ground only.
          //
          // This is the single detail that makes a canyon read as a canyon. Sedimentary rock is laid
          // down in layers, so a cut through it exposes stripes that stay LEVEL while the wall
          // itself undulates — and because they are keyed to altitude rather than to the surface,
          // they wrap around every buttress and side canyon exactly as the real ones do. A brown
          // ramp with noise on it never looks like the Grand Canyon; a striped one does at once.
          float alt = length(vWorldPos) * mpu;
          float wob = gCoarse * 26.0;                // edges wander, so it is geology not wallpaper
          float band = fract((alt + wob) / ${STRATA_M}.0);
          float layer = smoothstep(0.0, 0.35, band) * (1.0 - smoothstep(0.55, 0.95, band));
          vec3 warm = vec3(1.24, 0.84, 0.62);        // iron reds
          vec3 pale = vec3(0.94, 0.91, 0.84);        // pale sandstone
          diffuseColor.rgb *= mix(vec3(1.0), mix(pale, warm, layer), gCliff * 0.85);
        }
      `)
      // ROUGHNESS, in the chunk that declares it. Cliffs are broken and matte, flats smoother, plus
      // noise so no two patches of ground catch the sun identically — a single roughness value is a
      // large part of why it read as plastic.
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(mix(0.78, 0.99, gCliff) - (gDetail - 0.5) * 0.22, 0.35, 1.0);
      `)
      // THE NORMAL, in the chunk where `normal` exists, from the samples already taken above.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Sample the field slightly off in two tangent directions and take the gradient: the slope
          // of the fake relief, which is all a normal map ever is.
          vec3 t1 = normalize(abs(gWn.y) < 0.9 ? cross(gWn, vec3(0.0, 1.0, 0.0)) : vec3(1.0, 0.0, 0.0));
          vec3 t2 = cross(gWn, t1);
          float e = 1.2;                             // metres between samples
          float hx = triFbm(gWp + t1 * e, gWn, 1.0 / ${DETAIL_M_MID}.0);
          float hy = triFbm(gWp + t2 * e, gWn, 1.0 / ${DETAIL_M_MID}.0);

          // Strong relief on cliffs (fractured, loose rock), gentle on flats.
          float strength = mix(0.9, 3.4, gCliff);
          vec3 bump = normalize(gWn - (t1 * (hx - gD) + t2 * (hy - gD)) * strength);
          normal = normalize(mix(normal, bump, 0.8));
        }
      `);
  };

  // Changing onBeforeCompile after a material has been used needs a new cache key, and this is
  // set once at creation, but three.js caches programs by it — so give it a stable, distinct one.
  mat.customProgramCacheKey = () => 'globe-terrain-v1';
  return mat;
}
