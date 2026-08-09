// cityWindows — facades, without a single texture file.
//
// Geoff: "some textures that look like buildings (I could provide that) and we add some blinking
// lights and stuff... they shouldn't be like christmas lights but very rarely adding them."
//
// A texture would have to be tiled, and a tiled facade on 59,202 boxes of wildly different shapes
// gives you the same eight-storey pattern stretched over a 500 m tower and squashed onto a shed.
// The window grid is therefore DERIVED FROM EACH BUILDING'S OWN SIZE: four metres to a storey, four
// metres to a bay, so a 522 m tower gets 130 floors and a villa gets two, automatically, and every
// window is the same real-world size across the whole city. That is the thing that actually reads
// as a city rather than as decorated boxes.
//
// ON THE BLINKING, which is the part most easily overdone. Nearly every window here is FIXED — lit
// or dark for the whole session. Roughly one in forty is on a slow cycle, and the cycles are all at
// different rates and phases, so what you see is an occasional window somewhere in the city changing
// its mind. Nothing pulses in time with anything else. Make that fraction much larger and it stops
// being a city at night and becomes a Christmas tree, which is exactly what was asked against.
//
// The aircraft warning beacons are the only deliberately blinking thing, and they belong to
// cityLights — they are on roofs, not facades.

import * as THREE from 'three';

/** Metres per storey, and per window bay across. Real, and it makes every window the same size. */
const STOREY_M = 4.0;
const BAY_M = 4.0;

/**
 * Patch a standard material to draw windows.
 *
 * onBeforeCompile rather than a hand-written ShaderMaterial: this keeps three's own lighting, fog
 * and tone mapping, which a custom material would have to reimplement and would then quietly
 * disagree with every other object in the scene.
 */
export function applyCityWindows(material: THREE.Material, timeRef: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeRef;

    // The instance's real size in metres, and a per-building seed, both as instanced attributes.
    shader.vertexShader = `
      attribute vec3 iSize;
      attribute float iSeed;
      varying vec3 vSize;
      varying float vSeed;
      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vSize = iSize;
       vSeed = iSeed;
       vLocalPos = position;
       vLocalNormal = normal;`,
    );

    shader.fragmentShader = `
      uniform float uTime;
      varying vec3 vSize;
      varying float vSeed;
      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
    ` + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        // The box is a unit cube translated so its base is at y=0, so local position maps straight
        // to a fraction of the building. Multiply by the real size to get metres.
        vec3 n = abs(vLocalNormal);
        // ROOFS HAVE NO WINDOWS — but this is a MASK, not an "if", and that distinction is load
        // bearing. fwidth compares a value against its neighbours in a 2x2 block of pixels, so it is
        // only defined when all four take the same path through the shader. Wrapping the code below
        // in a branch on the face normal means the pixels along every roof edge disagree about
        // whether to run it, and the derivative there is formally undefined — in practice a bright
        // or black fringe along the top of every building. Computing it for all pixels and throwing
        // away the roof ones at the end costs a few instructions and is always correct.
        float wall = 1.0 - step(0.5, n.y);
        {
          // Which way is "across" this face: x for the north/south faces, z for east/west.
          float acrossM = n.z > n.x ? vSize.x : vSize.z;
          float alongU  = n.z > n.x ? (vLocalPos.x + 0.5) : (vLocalPos.z + 0.5);
          float floors = max(1.0, floor(vSize.y / ${STOREY_M.toFixed(1)}));
          float bays   = max(1.0, floor(acrossM / ${BAY_M.toFixed(1)}));

          vec2 cell = vec2(alongU * bays, vLocalPos.y * floors);
          vec2 id = floor(cell);
          vec2 f = fract(cell);

          // ANTI-ALIASING, and this is the whole reason the next twenty lines are not four.
          //
          // Geoff: "the texture is flickering like crazy as I move around... detailed textures at a
          // distance flicker and scintillate in a very bad way."
          //
          // That is aliasing, and a procedural pattern gets the worst possible case of it. An image
          // texture has MIPMAPS — the GPU keeps pre-averaged smaller copies and picks one to match
          // how big the texture is on screen, so a distant wall samples a blur instead of stabbing
          // at one pixel of the full-resolution image. A pattern computed in the shader has no
          // smaller copies to fall back on, so every pixel keeps asking "am I inside a window?" of a
          // four-metre grid that by then is a third of a pixel wide. Sub-pixel camera movement flips
          // the answer, and it flips independently for every pixel. That is the scintillation.
          //
          // fwidth gives the answer mipmaps would: how much of the pattern falls inside THIS pixel.
          // Two things then follow from it.
          // CLAMPED, because a 2x2 pixel block straddling a building's vertical corner spans two
          // faces whose cell values are unrelated, and the derivative there comes out enormous.
          // Left alone that single pixel line would read as fully-averaged wall down every corner of
          // every tower. Capping at four cells keeps the corner in range without affecting anything
          // that is genuinely far away, where the interesting values are well under one.
          vec2 w = min(fwidth(cell), vec2(4.0)) + 1e-5;

          // ONE — soften the window edges by exactly a pixel, so an edge crossing a pixel is a grey
          // pixel rather than a coin toss between wall and glass.
          float win =
              smoothstep(0.18 - w.x, 0.18 + w.x, f.x) * (1.0 - smoothstep(0.82 - w.x, 0.82 + w.x, f.x))
            * smoothstep(0.22 - w.y, 0.22 + w.y, f.y) * (1.0 - smoothstep(0.80 - w.y, 0.80 + w.y, f.y));

          // TWO — and this is the part that actually kills it. Once a whole window is near a pixel,
          // no amount of edge softening helps, because the LIT/UNLIT choice is random per window and
          // random per-pixel noise is the worst thing you can put on screen. So past that point stop
          // resolving individual windows at all and fade to their average, which is what a mipmap
          // would have handed back anyway. The wall keeps its overall brightness; it just stops
          // pretending to resolve detail it cannot.
          float detail = 1.0 - smoothstep(0.30, 0.85, max(w.x, w.y));

          float h = hash21(id + vSeed * 71.7);
          // A little over half the windows are lit, which is what an occupied tower looks like.
          float lit = step(0.44, h);

          // RARELY, and never in step with anything. One window in forty is on a slow cycle whose
          // period and phase both come from its own hash, so no two change together and there is no
          // rhythm to notice. This is the whole of the "blinking", and it is meant to be missable.
          if (h > 0.975) {
            float period = 6.0 + hash21(id * 3.1 + vSeed) * 20.0;
            lit = step(0.5, fract(uTime / period + h * 17.0));
          }

          // FADE TO THE AVERAGE, not to nothing. These two constants are the mean of the things they
          // replace: 0.64 x 0.58 of each cell is glass, and 56% of the windows are lit. Blending
          // toward them means a tower seen from ten kilometres has the same overall brightness as one
          // seen from ten metres — it simply stops resolving which windows. Fading to zero instead
          // would make the whole city visibly darken as you backed away from it.
          const float MEAN_WIN = 0.371;
          const float MEAN_LIT = 0.56;
          float winF = mix(MEAN_WIN, win, detail);
          float litF = mix(MEAN_LIT, lit, detail);

          // Warm inside, and slightly different per window — offices are cooler, homes warmer.
          // The tint is averaged out at distance too, or it would scintillate in colour instead.
          vec3 glow = mix(vec3(1.0, 0.82, 0.52), vec3(0.78, 0.86, 1.0),
                          mix(0.5, hash21(id + 9.1), detail));
          // wall is where the roof pixels get discarded — see the note on it above.
          gl_FragColor.rgb += glow * winF * litF * 0.85 * wall;
          // Unlit glass is darker than the wall, which is what makes the grid visible by day too.
          gl_FragColor.rgb *= 1.0 - winF * (1.0 - litF) * 0.45 * wall;
        }
      }`,
    );
  };
  material.needsUpdate = true;
}

/**
 * The same facade, for the buildings that are real polygons rather than boxes.
 *
 * A box can work out where it is on its own wall from its local position, because every box is the
 * same unit cube. An extruded polygon cannot: it has no canonical local space, its walls are all
 * different lengths, and a part that starts 200 m up needs its windows to line up with the floors of
 * the tower below it. So the bake supplies the two numbers directly — how far along the wall this
 * vertex is, and how high above SEA LEVEL, not above the part's own base. The second is what keeps
 * the Burj Khalifa's 38 stacked sections sharing one continuous grid of floors instead of each
 * starting a new one at its own base.
 *
 * A negative aWallU means "this is a roof" and gets no windows.
 */
export function applyDetailWindows(material: THREE.Material, timeRef: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeRef;

    shader.vertexShader = `
      attribute float aWallU;
      attribute float aWallY;
      attribute float aSeed;
      varying float vWallU;
      varying float vWallY;
      varying float vSeed2;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWallU = aWallU;
       vWallY = aWallY;
       vSeed2 = aSeed;`,
    );

    shader.fragmentShader = `
      uniform float uTime;
      varying float vWallU;
      varying float vWallY;
      varying float vSeed2;

      float hash21d(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
    ` + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        // Roofs carry a negative U from the bake. A MASK rather than a branch, for the same reason
        // as the box version: fwidth below is only defined when every pixel of a 2x2 block takes the
        // same path, and roof edges are exactly where they would not.
        float wall = 1.0 - step(vWallU, -0.5);
        vec2 cell = vec2(vWallU / ${BAY_M.toFixed(1)}, vWallY / ${STOREY_M.toFixed(1)});
        vec2 id = floor(cell);
        vec2 f = fract(cell);
        vec2 w = min(fwidth(cell), vec2(4.0)) + 1e-5;

        float win =
            smoothstep(0.18 - w.x, 0.18 + w.x, f.x) * (1.0 - smoothstep(0.82 - w.x, 0.82 + w.x, f.x))
          * smoothstep(0.22 - w.y, 0.22 + w.y, f.y) * (1.0 - smoothstep(0.80 - w.y, 0.80 + w.y, f.y));
        float detail = 1.0 - smoothstep(0.30, 0.85, max(w.x, w.y));

        float h = hash21d(id + vSeed2 * 71.7);
        float lit = step(0.44, h);
        if (h > 0.975) {
          float period = 6.0 + hash21d(id * 3.1 + vSeed2) * 20.0;
          lit = step(0.5, fract(uTime / period + h * 17.0));
        }

        const float MEAN_WIN = 0.371;
        const float MEAN_LIT = 0.56;
        float winF = mix(MEAN_WIN, win, detail);
        float litF = mix(MEAN_LIT, lit, detail);

        vec3 glow = mix(vec3(1.0, 0.82, 0.52), vec3(0.78, 0.86, 1.0),
                        mix(0.5, hash21d(id + 9.1), detail));
        gl_FragColor.rgb += glow * winF * litF * 0.85 * wall;
        gl_FragColor.rgb *= 1.0 - winF * (1.0 - litF) * 0.45 * wall;
      }`,
    );
  };
  material.needsUpdate = true;
}
