// terrainBlend — a 3-texture (sand / grass / rock) terrain material. Instead of one detail texture
// tinted by a flat per-vertex colour, this blends three real textures by a per-vertex WEIGHT attribute
// `aWgt` (x=sand, y=grass, z=rock). The weights are authored by each terrain layer from the same
// height + slope rules it used for the old vertex colour (sand at the waterline, grass on land, rock on
// steep ground), so the biomes land exactly where they did — just with real textures.
//
// Built on MeshStandardMaterial via onBeforeCompile so it keeps the engine's normal lighting; only the
// albedo (diffuseColor) is replaced. All three textures share the mesh's existing UV (world-XZ / repeat),
// so they tile at the same scale.
import * as THREE from 'three';

/** Load a tiling sRGB albedo texture for terrain (repeat-wrapped). */
export function loadTerrainTex(url: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface TerrainBlendOpts { color?: THREE.Color; side?: THREE.Side }

export function makeTerrainBlendMaterial(sand: THREE.Texture, grass: THREE.Texture, rock: THREE.Texture, opts: TerrainBlendOpts = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: rock,                                   // gives the shader its UV plumbing (vMapUv); overridden below
    roughness: 1, metalness: 0,
    color: opts.color ?? new THREE.Color(1, 1, 1),
    side: opts.side ?? THREE.FrontSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uGrass = { value: grass };
    shader.uniforms.uRock = { value: rock };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWgt;\nvarying vec3 vWgt;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vWgt = aWgt;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uSand;\nuniform sampler2D uGrass;\nuniform sampler2D uRock;\nvarying vec3 vWgt;')
      .replace('#include <map_fragment>', `
        vec3 _w = vWgt / max(vWgt.x + vWgt.y + vWgt.z, 1e-4);
        vec4 _terr = texture2D( uSand, vMapUv ) * _w.x + texture2D( uGrass, vMapUv ) * _w.y + texture2D( uRock, vMapUv ) * _w.z;
        diffuseColor *= _terr;
      `);
  };
  // All instances compile to the same program (day/night differ only by the `color` uniform).
  mat.customProgramCacheKey = () => 'siege-terrain-blend';
  return mat;
}

/** Write sand/grass/rock weights for one vertex into `out` (length-3). */
export function blendWeights(sand: number, grass: number, rock: number, out: Float32Array, i: number) {
  out[i * 3] = sand; out[i * 3 + 1] = grass; out[i * 3 + 2] = rock;
}
