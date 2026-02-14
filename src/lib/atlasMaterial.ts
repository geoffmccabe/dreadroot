/**
 * Atlas Material Utilities
 *
 * Creates THREE.js materials with shader modifications for atlas UV offsets.
 * Used by enemy renderers and tree blocks to sample the correct region of the global atlas.
 */

import * as THREE from 'three';
import { ATLAS_GRID_SIZE } from './textureAtlas';

const SLOT_UV_SIZE = 1 / ATLAS_GRID_SIZE;
// Half-texel inset in slot-local UV space to prevent bilinear filtering bleed
// Each slot is 256 texels, so half texel = 0.5/256
const HALF_TEXEL = 0.5 / 256;
// Larger inset for tree blocks (4 texels) — prevents visible bleed at block edges
const TREE_TEXEL_INSET = 4.0 / 256;

/**
 * Create a MeshLambertMaterial with atlas UV offset support
 * Adds instanceUvOffset attribute to sample correct atlas region per instance
 */
export function createAtlasLambertMaterial(atlasTexture: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    color: 0xffffff,
  });

  material.onBeforeCompile = (shader) => {
    // Add attribute for UV offset
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute vec2 instanceUvOffset;
      varying vec2 vInstanceUvOffset;`
    );

    // Pass UV offset to fragment shader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vInstanceUvOffset = instanceUvOffset;`
    );

    // Receive UV offset in fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 vInstanceUvOffset;`
    );

    // Apply UV offset when sampling the texture (with half-texel inset to prevent slot bleeding)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 slotUv = clamp(fract(vMapUv), vec2(${HALF_TEXEL.toFixed(6)}), vec2(${(1 - HALF_TEXEL).toFixed(6)}));
        vec2 atlasUv = vInstanceUvOffset + slotUv * ${SLOT_UV_SIZE.toFixed(6)};
        vec4 sampledDiffuseColor = texture2D(map, atlasUv);
        diffuseColor *= sampledDiffuseColor;
      #endif`
    );
  };

  return material;
}

/**
 * Create a MeshStandardMaterial with atlas UV offset support
 * For higher quality rendering with roughness/metalness
 */
export function createAtlasStandardMaterial(
  atlasTexture: THREE.Texture,
  options?: { roughness?: number; metalness?: number }
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: atlasTexture,
    color: 0xffffff,
    roughness: options?.roughness ?? 0.4,
    metalness: options?.metalness ?? 0.1,
  });

  material.onBeforeCompile = (shader) => {
    // Add attribute for UV offset
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute vec2 instanceUvOffset;
      varying vec2 vInstanceUvOffset;`
    );

    // Pass UV offset to fragment shader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vInstanceUvOffset = instanceUvOffset;`
    );

    // Receive UV offset in fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 vInstanceUvOffset;`
    );

    // Apply UV offset when sampling the texture (with half-texel inset to prevent slot bleeding)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 slotUv = clamp(fract(vMapUv), vec2(${HALF_TEXEL.toFixed(6)}), vec2(${(1 - HALF_TEXEL).toFixed(6)}));
        vec2 atlasUv = vInstanceUvOffset + slotUv * ${SLOT_UV_SIZE.toFixed(6)};
        vec4 sampledDiffuseColor = texture2D(map, atlasUv);
        #ifdef DECODE_VIDEO_TEXTURE
          sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
        #endif
        diffuseColor *= sampledDiffuseColor;
      #endif`
    );
  };

  return material;
}

/**
 * Create a MeshStandardMaterial with atlas UV offset + per-instance hue shift.
 * Used by ShwarmRenderer to tint each tier a different color.
 */
export function createAtlasHueShiftMaterial(
  atlasTexture: THREE.Texture,
  options?: { roughness?: number; metalness?: number }
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: atlasTexture,
    color: 0xffffff,
    roughness: options?.roughness ?? 0.4,
    metalness: options?.metalness ?? 0.1,
  });

  material.onBeforeCompile = (shader) => {
    // Vertex: declare attributes and pass to fragment
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute vec2 instanceUvOffset;
      attribute float instanceHueShift;
      attribute float instanceEffects;
      varying vec2 vInstanceUvOffset;
      varying float vHueShift;
      varying float vEffectMode;`
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vInstanceUvOffset = instanceUvOffset;
      vHueShift = instanceHueShift;
      vEffectMode = instanceEffects;`
    );

    // Fragment: receive varyings + add HSV conversion functions
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 vInstanceUvOffset;
      varying float vHueShift;
      varying float vEffectMode;

      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
      }

      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }`
    );

    // Sample atlas + apply hue shift + effect modes
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 slotUv = clamp(fract(vMapUv), vec2(${HALF_TEXEL.toFixed(6)}), vec2(${(1 - HALF_TEXEL).toFixed(6)}));
        vec2 atlasUv = vInstanceUvOffset + slotUv * ${SLOT_UV_SIZE.toFixed(6)};
        vec4 sampledDiffuseColor = texture2D(map, atlasUv);
        #ifdef DECODE_VIDEO_TEXTURE
          sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
        #endif

        // Apply hue shift (T1-T8 color tinting)
        if (vHueShift > 0.001) {
          vec3 hsv = rgb2hsv(sampledDiffuseColor.rgb);
          hsv.x = fract(hsv.x + vHueShift);
          sampledDiffuseColor.rgb = hsv2rgb(hsv);
        }

        // Effect mode post-processing
        if (vEffectMode > 0.5 && vEffectMode < 1.5) {
          // Mode 1: White/Divine - desaturate + brighten
          vec3 hsv = rgb2hsv(sampledDiffuseColor.rgb);
          hsv.y *= 0.1;           // Nearly remove saturation
          hsv.z = min(hsv.z * 1.3, 1.0); // Brighten
          sampledDiffuseColor.rgb = hsv2rgb(hsv);
        } else if (vEffectMode > 1.5 && vEffectMode < 2.5) {
          // Mode 2: Apocalyptic - desaturate + invert
          vec3 hsv = rgb2hsv(sampledDiffuseColor.rgb);
          hsv.y *= 0.3;           // Mostly desaturate
          sampledDiffuseColor.rgb = hsv2rgb(hsv);
          sampledDiffuseColor.rgb = vec3(1.0) - sampledDiffuseColor.rgb; // Invert
        } else if (vEffectMode > 2.5 && vEffectMode < 3.5) {
          // Mode 3: Cosmic - metallic boost (increase brightness, add specular sheen)
          vec3 hsv = rgb2hsv(sampledDiffuseColor.rgb);
          hsv.z = min(hsv.z * 1.4, 1.0); // Boost brightness
          hsv.y = max(hsv.y * 0.7, 0.2);  // Slightly reduce saturation for metallic look
          sampledDiffuseColor.rgb = hsv2rgb(hsv);
          // Add subtle specular highlight
          sampledDiffuseColor.rgb += vec3(0.15, 0.12, 0.05); // Warm metallic tint
        }

        diffuseColor *= sampledDiffuseColor;
      #endif`
    );
  };

  return material;
}

/**
 * Create a MeshLambertMaterial with atlas UV offset + per-face directional shading.
 * Used by tree block rendering (InstancedAtlasBlockGroup, MergedTreeMesh).
 * Top face = full brightness, sides = 0.8-0.9, bottom = 0.65.
 */
export function createTreeAtlasMaterial(atlasTexture: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    color: 0xffffff,
    transparent: false,
    alphaTest: 0,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute vec2 instanceUvOffset;
      varying vec2 vInstanceUvOffset;
      varying float vFaceShade;`
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vInstanceUvOffset = instanceUvOffset;

      // Per-face directional shading based on world normal
      vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
      if (worldNormal.y > 0.5) {
        vFaceShade = 1.0;        // Top face - full brightness
      } else if (worldNormal.y < -0.5) {
        vFaceShade = 0.65;       // Bottom face - darkest
      } else if (abs(worldNormal.z) > 0.5) {
        vFaceShade = 0.8;        // Front/back faces - medium
      } else {
        vFaceShade = 0.9;        // Left/right faces - slightly darker
      }`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 vInstanceUvOffset;
      varying float vFaceShade;`
    );

    const slotSize = SLOT_UV_SIZE;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 slotUv = clamp(fract(vMapUv), vec2(${TREE_TEXEL_INSET.toFixed(6)}), vec2(${(1 - TREE_TEXEL_INSET).toFixed(6)}));
        vec2 atlasUv = vInstanceUvOffset + slotUv * ${slotSize.toFixed(6)};
        vec4 sampledDiffuseColor = texture2D(map, atlasUv);
        // Apply per-face directional shading for depth perception
        sampledDiffuseColor.rgb *= vFaceShade;
        diffuseColor *= sampledDiffuseColor;
      #endif`
    );
  };

  return material;
}

/**
 * Create or update hue shift attribute for an InstancedMesh
 */
export function createHueShiftAttribute(
  mesh: THREE.InstancedMesh,
  maxInstances: number
): THREE.InstancedBufferAttribute {
  const data = new Float32Array(maxInstances);
  const attr = new THREE.InstancedBufferAttribute(data, 1);
  mesh.geometry.setAttribute('instanceHueShift', attr);
  return attr;
}

/**
 * Set hue shift for a specific instance
 */
export function setInstanceHueShift(
  attr: THREE.InstancedBufferAttribute,
  instanceIndex: number,
  hueShift: number
): void {
  (attr.array as Float32Array)[instanceIndex] = hueShift;
}

/**
 * Create effects attribute for an InstancedMesh
 * Effect modes: 0=normal, 1=White/Divine, 2=Apocalyptic, 3=Cosmic
 */
export function createEffectsAttribute(
  mesh: THREE.InstancedMesh,
  maxInstances: number
): THREE.InstancedBufferAttribute {
  const data = new Float32Array(maxInstances);
  const attr = new THREE.InstancedBufferAttribute(data, 1);
  mesh.geometry.setAttribute('instanceEffects', attr);
  return attr;
}

/**
 * Set effect mode for a specific instance
 */
export function setInstanceEffects(
  attr: THREE.InstancedBufferAttribute,
  instanceIndex: number,
  effectMode: number
): void {
  (attr.array as Float32Array)[instanceIndex] = effectMode;
}

/**
 * Create or update UV offset attribute for an InstancedMesh
 * Returns the attribute for further updates
 */
export function createUvOffsetAttribute(
  mesh: THREE.InstancedMesh,
  maxInstances: number
): THREE.InstancedBufferAttribute {
  const uvOffsetData = new Float32Array(maxInstances * 2);
  const attr = new THREE.InstancedBufferAttribute(uvOffsetData, 2);
  mesh.geometry.setAttribute('instanceUvOffset', attr);
  return attr;
}

/**
 * Set UV offset for a specific instance
 */
export function setInstanceUvOffset(
  attr: THREE.InstancedBufferAttribute,
  instanceIndex: number,
  uvOffsetX: number,
  uvOffsetY: number
): void {
  const array = attr.array as Float32Array;
  array[instanceIndex * 2] = uvOffsetX;
  array[instanceIndex * 2 + 1] = uvOffsetY;
}
