/**
 * Paints the shared SWU texture atlas onto weapon models that shipped without one.
 *
 * Nine of the converted Siege Worlds weapons — the Basic Pistol, the Revolver,
 * Shi Yang's Pistol, Bonnie's Rifle and friends — export with correct UVs but a
 * bare white material and no embedded image. They render as featureless white
 * props. The texture they were authored against is not lost: it is embedded in
 * a SIBLING weapon's glb (the Musket carries PolygonMilitary_Weapons_01, the
 * Plasma Sniper carries PolygonScifi_01_A), so both were extracted once to
 * /siege/weapons/atlas_*.png and are applied here at load.
 *
 * Which atlas a given model wants is a judgement call for some of them, so the
 * choice is a field on the weapon registry and can be cycled live with ';' in
 * the lineup, then baked. Cycling is why the ORIGINAL material is kept: going
 * back to 'none' has to restore the model rather than leave a wrong texture on.
 *
 * Models that carry their own texture, and models that carry hand-authored
 * per-material COLOURS instead of one (the AK74's wood and greys, the Flame
 * Glove's glow, the Pickaxe), are never touched at all.
 */
import * as THREE from 'three';

export type AtlasKind = 'military' | 'scifi';

const ATLAS_URL: Record<AtlasKind, string> = {
  military: '/siege/weapons/atlas_military.png',
  scifi: '/siege/weapons/atlas_scifi.png',
};

const textures = new Map<string, THREE.Texture>();

/** A texture by url, loaded once and shared. TextureLoader hands back a Texture
 *  immediately and fills in the image later, so there is nothing to await.
 *
 *  flipY MUST be false. Sampled against the atlas, the flipped read gives sensible
 *  weapon colours (grey metal 111/114/117, wood 179/148/130) while the unflipped
 *  read gives one flat grey for every part — which is what "no texture" looks like. */
function textureAt(url: string): THREE.Texture {
  let t = textures.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.flipY = false;                       // glTF UV convention
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(url, t);
  }
  return t;
}

/** The image a weapon should wear: its own texture file, else a shared atlas, else nothing. */
export function textureUrlFor(
  url: string, baked: AtlasKind | undefined, ownTexture: string | undefined,
): string | null {
  const o = override.get(url);
  if (o !== undefined) return o === 'none' ? null : ATLAS_URL[o];
  if (ownTexture) return ownTexture;
  return baked ? ATLAS_URL[baked] : null;
}

/** Live overrides set by the ';' key, keyed by weapon url. */
const override = new Map<string, AtlasKind | 'none'>();
/** Bumped on every override change so the renderer knows to re-apply. */
export let atlasVersion = 0;

export function currentAtlas(url: string, baked: AtlasKind | undefined): AtlasKind | 'none' {
  return override.get(url) ?? baked ?? 'none';
}

/** none → military → scifi → none. Returns the new value. */
export function cycleAtlas(url: string, baked: AtlasKind | undefined): AtlasKind | 'none' {
  const order: Array<AtlasKind | 'none'> = ['none', 'military', 'scifi'];
  const next = order[(order.indexOf(currentAtlas(url, baked)) + 1) % order.length];
  override.set(url, next);
  atlasVersion++;
  return next;
}

/**
 * Apply (or remove) the atlas across a cloned weapon model.
 *
 * Materials are cloned on first touch because `Object3D.clone()` SHARES material
 * references — mutating them in place would repaint the cached glb and every
 * other character holding the same gun.
 */
export function applyAtlas(model: THREE.Object3D, texUrl: string | null): void {
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = mats.map((m) => {
      const std = m as THREE.MeshStandardMaterial;
      // A model that shipped with its own texture is left completely alone.
      if (std.map && !std.userData.__atlasClone) return std;
      // Nothing has been painted and nothing is being painted → do not touch it.
      // This matters: the AK74, Pickaxe and Flame Glove carry hand-authored PER-MATERIAL
      // COLOURS (wood, dark grey, glow) instead of a texture. Forcing them white to make an
      // atlas read correctly would strip exactly the colours that make them look right.
      if (texUrl === null && !std.userData.__atlasClone) return std;

      const c = std.userData.__atlasClone ? std : (() => {
        const cl = std.clone();
        cl.userData = {
          ...std.userData,
          __atlasClone: true,
          __origColor: std.color ? std.color.clone() : null,
        };
        return cl;
      })();

      if (texUrl === null) {
        // Put the model back exactly as it came.
        c.map = null;
        const oc = c.userData.__origColor as THREE.Color | null;
        if (oc && c.color) c.color.copy(oc);
      } else {
        c.map = textureAt(texUrl);
        // The atlas supplies the colour, so the base tint must be neutral or it multiplies through.
        c.color?.setRGB(1, 1, 1);
      }
      c.needsUpdate = true;
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
  });
}

/** Lines for the '\\' clipboard export, so a cycled choice can be baked. */
export function atlasExportLines(): string[] {
  return [...override.entries()].map(([url, kind]) => `  ${url}  atlas: ${kind}`);
}
