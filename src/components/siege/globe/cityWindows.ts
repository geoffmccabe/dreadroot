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
        // ROOFS HAVE NO WINDOWS. Without this the grid wraps over the top of every tower and the
        // city reads as a circuit board from above — which is the angle a flying Kaiju sees most.
        if (n.y < 0.5) {
          // Which way is "across" this face: x for the north/south faces, z for east/west.
          float acrossM = n.z > n.x ? vSize.x : vSize.z;
          float alongU  = n.z > n.x ? (vLocalPos.x + 0.5) : (vLocalPos.z + 0.5);
          float floors = max(1.0, floor(vSize.y / ${STOREY_M.toFixed(1)}));
          float bays   = max(1.0, floor(acrossM / ${BAY_M.toFixed(1)}));

          vec2 cell = vec2(alongU * bays, vLocalPos.y * floors);
          vec2 id = floor(cell);
          vec2 f = fract(cell);

          // The window itself: a margin of wall around each pane, so there is structure between
          // them rather than one continuous band of glass.
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.80);

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

          // Warm inside, and slightly different per window — offices are cooler, homes warmer.
          vec3 glow = mix(vec3(1.0, 0.82, 0.52), vec3(0.78, 0.86, 1.0), hash21(id + 9.1));
          gl_FragColor.rgb += glow * win * lit * 0.85;
          // Unlit glass is darker than the wall, which is what makes the grid visible by day too.
          gl_FragColor.rgb *= 1.0 - win * (1.0 - lit) * 0.45;
        }
      }`,
    );
  };
  material.needsUpdate = true;
}
