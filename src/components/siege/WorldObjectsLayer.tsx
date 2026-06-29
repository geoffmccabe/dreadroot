// WorldObjectsLayer — renders the real world from the Unity export (WorldPlacements
// → world/placements.json). Each group = one model's glb + the exact world matrices
// (Unity transform, X-mirrored to match the terrain). Instanced per sub-mesh.
// Per-group error boundary so one bad/missing glb can't take down the world.

import { Component, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldCollisionGrid, monsterColliderGrid } from '@/lib/spatialHashGrid';
import { managedRocks, keyFor, colliderOverrides, mergeBakedOverrides, loadColliderOverridesFromDB } from './voxelOverrides';
import { siegeLoadStart, siegeLoadFinish } from './siegeInitLoad';
import { loadColliderCache, getCachedBoxes, recordBoxes, groupColliderSig } from './siegeColliderCache';
import { registerMeshGeometry, setGroupInstances, clearGroup, setMeshCollidersEnabled, clearMeshColliders, type MeshInstanceInput } from './meshColliderSystem';
import { windTime, applyLeafWind } from './siegeWind';
import { applyTrunkBark, TRUNK_TREE_RE } from './siegeTreeBark';
import { scifiAsset } from '@/config/assetBase';
import { placeKey, transformOverrides } from '@/features/objectEditor/bakedOverrides';

// The siege/scifi library moved off the Pages build onto R2 (assets.dreadroot.com). Placement
// `url`s saved as local /siege/scifi/<name>.gltf must resolve to the merged .glb on R2, or the
// object (warpgate, crystals, etc.) loads neither geometry nor texture and renders grey. World
// exports under /siege/world/ stay in the Pages build and pass through unchanged.
const resolveModelUrl = (url: string): string =>
  url.startsWith('/siege/scifi/') ? scifiAsset(url.slice('/siege/scifi/'.length)) : url;

let _meshGroupId = 0;
import { voxelizeGeometry } from './voxelize';

interface Group { fbx: string; url: string; matrices: number[][]; rotX?: number; mesh?: string; combined?: boolean; scaleMul?: number; whole?: boolean }

// Which object types get a solid collider (structures, not foliage/clutter you walk through).
const SOLID_RE = /bld|wall|tower|gate|bank|town|cave|colosseum|forge|building|house|hut|barrier|fence|dock|pier|bridge|ruin/i;
const FOLIAGE_RE = /plant|grass|ivy|tree|flower|bush|fern|leaf|vine|reed|seaweed|coral|moss/i;
const isSolidGroup = (fbx: string) => SOLID_RE.test(fbx) && !FOLIAGE_RE.test(fbx);
// Chunky props that should ALSO be solid + laser-pickable even though they miss SOLID_RE / are
// foliage-named: the giant mushrooms (mushroom*tree* etc.), tents, stalagmites, camp clutter,
// columns, dead trees. Real foliage (grass/ferns/flowers/plants/vines/reeds) stays walk-through.
const SOLID_PROP_RE = /mushroom|tent|stalag|crate|barrel|campfire|whetstone|log_pile|log_fence|table|column|pillar|stone_path|statue|plinth|bonepile|anvil|leafless_tree|tree_root|tree_stump|stump|tree_giant|tree_large|tree_medium|tree_trunk|tree_house|tree_portal|env_log|env_roots/i;
// Decorative scatter the player should walk THROUGH — so it never gets a player-collision mesh BVH.
// EF has hundreds of mushrooms; each one's canopy triangles in the merged BVH is pure heap + build
// cost for zero gameplay value (you don't stand on a mushroom). Trees/rocks/logs/stumps keep colliders.
const NO_PLAYER_COLLIDE_RE = /mushroom|toadstool|stalag/i;

// Objects mapped to the PP_Color_Palette swatch sheet (hash f50be3a42b) render as a single
// flat — and wrong — color (terra-cotta rocks, near-black tent), because that palette doesn't
// match their UVs. Until a correct PP palette is sourced, give the stone/cave and tent families
// a sensible flat color so the island reads right. Only objects ON that palette are affected,
// so correctly-textured rocks elsewhere are untouched.
const PP_PALETTE_HASH = 'f50be3a42b';
const STONE_FAM_RE = /rock|stone|boulder|cliff|rune|pillar|plateau|column|stalag|mound|cave|mountain/i;
const TENT_FAM_RE = /tent|tarp|bedroll/i;
const STONE_GREY = 0x86827b;   // warm stone grey, to match the other rocks
const TENT_TAN = 0xb0a585;     // canvas/tan, so the tent isn't near-black

// The SM_Tree_* lobby trees were authored for a texture that isn't cbc2b77227 (the palette they
// got), so their UVs sample white/wrong swatches → "crazy white" leaves + random trunks. Until a
// correct tree texture exists, give leaves a leaf-green (varied per tree for a gradient feel) and
// trunks brown — the Synty flat-shaded look. Leaves also get the subtle wind sway.
const TREE_RE = /tree|palm|willow|birch|pine|oak|cedar|spruce|fir|trunk|leave|foliage|branch|bush/i;
const LEAF_GREENS = [0x4f7a32, 0x5d8a3a, 0x42692b, 0x6a9a44, 0x567f2e];
const BARK_BROWN = 0x584027;
const hashIdx = (s: string, n: number) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % n; };

// Shared atlas cache: each Synty pack atlas is loaded ONCE and reused across every
// model that uses it — small memory, no per-model textures embedded.
const atlasCache = new Map<string, THREE.Texture>();
const texLoader = new THREE.TextureLoader();
function getAtlas(url: string): THREE.Texture {
  let t = atlasCache.get(url);
  if (!t) {
    t = texLoader.load(url);
    t.flipY = false;                 // glTF UV convention
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    atlasCache.set(url, t);
  }
  return t;
}

// Models whose source FBX is authored facing the opposite way, so they render 180°
// turned from where they belong. Each is verified portal-area-only (no correct reuse
// elsewhere), so a blanket per-fbx 180° Y turn is safe. Grows as more are laser-flagged.
// Emptied: the per-model 180° hack is superseded by the proper Unity->engine similarity
// conversion in process_world (negate row 0 AND col 0). The portal cluster + vault stall
// should now orient correctly from the data itself. Kept as a mechanism in case specific
// FBX still need a manual turn after the conversion fix.
const FLIP_180 = new Set<string>([]);

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

// Greedy boxes for ONE instance, for monsters to climb. Cell size auto-scales to
// the object: small rocks get fine boxes (hug the shape → minimal air-climbing),
// huge town blobs stay coarse/cheap. A saved V-tool cell overrides the auto value.
// Retries coarser if voxelize bails (SOLID_CAP); single AABB only as a last resort.
const _mbSize = new THREE.Vector3();
const MB_TARGET_CELLS = 8;   // ~boxes per axis for a typical object
const MB_MIN_CELL = 0.6;     // finest box (small rocks → many tight boxes)
const MB_MAX_CELL = 3.0;     // coarsest (big blobs stay manageable)
function monsterBoxesFor(geo: THREE.BufferGeometry, world: THREE.Matrix4, geoBox: THREE.Box3, ovCell?: number, finer = false): THREE.Box3[] {
  const wb = geoBox.clone().applyMatrix4(world);
  wb.getSize(_mbSize);
  const maxDim = Math.max(_mbSize.x, _mbSize.y, _mbSize.z);
  // `finer` = organic overhangs (mushrooms/stalagmites): many small boxes that hug the stem +
  // cap so monsters don't climb the empty air the coarse AABB would leave under the cap.
  const target = finer ? 22 : MB_TARGET_CELLS;
  const minCell = finer ? 0.35 : MB_MIN_CELL;
  // Organic overhangs (mushrooms/stalagmites) cap their box size so even a GIANT mushroom-tree
  // gets sub-1.2m, shape-hugging boxes (climbable stem + cap) instead of a coarse 2-3m blob.
  const maxCell = finer ? 1.2 : MB_MAX_CELL;
  let cell = ovCell ?? Math.min(maxCell, Math.max(minCell, maxDim / target));
  for (let tries = 0; tries < 4; tries++) {
    const boxes = voxelizeGeometry(geo, world, cell, 4000);
    if (boxes.length) return boxes;
    cell *= 1.8;  // hit SOLID_CAP → coarsen and retry
  }
  return [wb];
}

function GroupInstances({ url, matrices, rotX, meshName, combined, fbx, scaleMul, whole, atlasUrl, matMap, cutout, meshColliders, trustMaterials, noMonsterColliders, emissiveBoost = 1, colliderKey }:
  { url: string; matrices: number[][]; rotX?: number; meshName?: string; combined?: boolean; fbx: string; scaleMul?: number; whole?: boolean; atlasUrl?: string; matMap?: Record<string, string>; cutout?: Set<string>; meshColliders?: boolean; trustMaterials?: boolean; noMonsterColliders?: boolean; emissiveBoost?: number; colliderKey?: string }) {
  const gltf = useGLTF(url, '/draco/');   // '/draco/' so sampler glbs (e.g. the warpgate) decode; plain world glbs ignore it
  const gidRef = useRef<string | null>(null);
  if (gidRef.current === null) gidRef.current = `mg${_meshGroupId++}`;
  const groupId = gidRef.current;
  // DUAL colliders (Siege): every collidable object gets BOTH a smooth mesh BVH
  // (player + bullets) AND greedy boxes in the monster-only grid (monsters climb).
  // The old per-model M-flag is no longer needed — kept only as a V-tool cell hint.
  const ovCell = colliderOverrides.get(fbx)?.cell;
  const { node, colliders, meshInputs, meshGeos, monsterBoxes } = useMemo(() => {
    const out = new THREE.Group();
    const colliders: THREE.Box3[] = [];
    const meshInputs: MeshInstanceInput[] = [];
    const meshGeos = new Map<string, THREE.BufferGeometry>();
    const monsterBoxes: THREE.Box3[] = [];
    // Monster-climb boxes are the per-instance VOXELIZE cost (main-thread). On a repeat visit they're
    // restored from IndexedDB (keyed by this group's matrices), skipping the rebuild entirely.
    const collSig = colliderKey ? groupColliderSig(fbx, meshName, matrices) : null;
    const cachedBoxes = collSig ? getCachedBoxes(collSig) : null;
    const solid = isSolidGroup(fbx);
    // Mesh-AABBs run loose; shrink toward the real object size. Rocks are the worst (organic
    // shapes in a big box) → 60%; everything else → 80%.
    const isRock = /rock|stone|boulder|cliff|mountain/i.test(fbx) || SOLID_PROP_RE.test(fbx);
    const isTerrain = /terrain/i.test(fbx);   // baked ground mesh → walkable BVH (player + heightmap baker)
    const organicFine = /mushroom|stalag/i.test(fbx);   // overhang shapes → finer monster boxes
    const shrinkF = 0.8;  // non-rocks: 80% box (rocks get voxelized to match their shape)
    let meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    // Combined bake: render only the named sub-mesh for this group.
    if (combined && meshName) {
      const base = (n: string) => n.replace(/\.\d{3}$/, '');
      meshes = meshes.filter((mm) => base(mm.name) === meshName || base(mm.name).startsWith(meshName));
    }
    const m = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const corr = rotX ? new THREE.Matrix4().makeRotationX((rotX * Math.PI) / 180) : null;
    // Combined bakes need the +90° X axis-conversion the single-mesh kit nodes carry — without
    // it nearly every combined object lies on its side. (Keep; the _gpui float is separate.)
    const bakeFix = combined ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : null;
    // Per-model 180° Y correction for FBX authored facing backward (portal cluster).
    // Applied as a quaternion turn that KEEPS the world position fixed (turn in place),
    // so off-center pivots don't swing the model sideways.
    const flipQ = FLIP_180.has(fbx) ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) : null;
    // Synty models convert to node-scale 0.01; a few came out wildly wrong (baskets=100,
    // BeachTown=0.0001). Snap those extreme outliers back to 0.01.
    const norm = (v: number) => (v > 5 || v < 0.005 ? 0.01 : v);
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
    for (const src of meshes) {
      src.updateWorldMatrix(true, false);
      local.copy(src.matrixWorld);
      if (whole) {
        // Hierarchical model placed at one exact root: use the node matrix as-is
        // (the root matrix already encodes scale/rotation). No norm / no axis-fix.
      } else if (combined) {
        // Export matrix already holds world position+rotation: use ONLY scale + the +90°X axis-fix.
        local.decompose(P, Q, S);
        local.makeScale(norm(S.x), norm(S.y), norm(S.z));
        if (bakeFix) local.premultiply(bakeFix);
      } else {
        // Single-mesh: keep rotation/position, normalize any broken conversion scale,
        // then apply an optional per-model size multiplier (e.g. the giant skull).
        local.decompose(P, Q, S);
        const k = scaleMul ?? 1;
        local.compose(P, Q, S.set(norm(S.x) * k, norm(S.y) * k, norm(S.z) * k));
      }
      if (corr) local.premultiply(corr);
      const mats = Array.isArray(src.material) ? src.material : [src.material];
      mats.forEach((mm) => {
        const m = mm as THREE.MeshStandardMaterial;
        m.side = THREE.DoubleSide;
        // trustMaterials: this glTF was baked with correct Synty textures + emissive glow maps
        // (KHR_materials_emissive_strength) — keep them verbatim. Skip the DreadRoot/old-SW-export
        // munging below (tree-flatten, PP-palette, flat-emissive-zero, atlas override) which would
        // strip the glow and replace textures with flat colours. Only force non-metal.
        if (trustMaterials) {
          if ('metalness' in m) m.metalness = 0;
          // Boost the Synty emissive glow so it crosses the AgX bloom threshold (~0.9). The glow
          // maps survive export at KHR strength ~2.2, but AgX tone-mapping compresses that below
          // threshold → the "enchanted" glow reads flat. Multiply intensity ONLY where there's a
          // real glow map (a flat factor with no map would just wash the surface out).
          if (emissiveBoost !== 1 && 'emissiveIntensity' in m && m.emissiveMap) {
            m.emissiveIntensity *= emissiveBoost;
          }
          // Crystals / geodes / water exported as opaque (alphaMode MASK) — they're meant to be
          // translucent glowing gems / transparent water. Honour the baseColor alpha and let the
          // glow bleed through (no depth-write so they don't occlude the swarm/world behind them).
          if (/crystal|geode|gem|shard|water/i.test(fbx) && 'opacity' in m) {
            m.transparent = true; m.depthWrite = false;
            if (m.alphaTest) m.alphaTest = 0;
            if (m.opacity >= 1) m.opacity = 0.7;
          }
          // Trees + fern-trees: trunk shares the green leaf atlas (Synty bark texture dropped on
          // export). Re-split via the COLOR_1.b vertex mask so trunk fragments sample the bark atlas
          // (which sits in the same model folder). Big-tree trunks go brown; fern-tree trunks reappear.
          if (TRUNK_TREE_RE.test(fbx)) {
            const barkUrl = url.replace(/[^/]+$/, '') + 'PolygonNatureBiomesS2_Texture_01.webp';
            applyTrunkBark(m, getAtlas(barkUrl));
          }
          return;
        }
        // Kill baked flat self-illumination artifacts. Many world objects ship with a constant
        // emissiveFactor and NO emissiveMap, so the WHOLE surface self-illuminates a solid colour
        // and washes out the texture: green (0.23,0.39,0.25) on PP_ rocks/caves, and WHITE (1,1,1)
        // on the Forge, World Fountain, WeaponExchange and Ores (that's why the forge reads "all
        // white"). A genuine glow needs an emissiveMap (so only parts glow) — a flat factor with no
        // map is always the artifact. Zero ANY flat emissive that has no map (white included).
        if ('emissive' in m && m.emissive && !m.emissiveMap) {
          const e = m.emissive;
          if (Math.max(e.r, e.g, e.b) > 0.02) { e.setRGB(0, 0, 0); m.needsUpdate = true; }
        }
        // TREES: leaves → leaf-green (+ wind), trunks → brown, dead leaves → autumn. Bypass the
        // broken palette texture entirely.
        const mn = m.name.toLowerCase();
        if (TREE_RE.test(fbx)) {
          const deadTree = /dead|stump|log/i.test(fbx);
          const isLeaf = /leave|leaf|foliage|canopy|frond/.test(mn);
          const isTrunk = /trunk|bark|branch|wood|stem/.test(mn);
          if (isLeaf || isTrunk || mn.startsWith('lambert')) {
            m.map = null; if ('metalness' in m) m.metalness = 0;
            if ('emissive' in m && m.emissive) m.emissive.setRGB(0, 0, 0);
            if (isTrunk || deadTree) m.color.set(BARK_BROWN);   // trunks + bare dead trees → brown
            else { m.color.set(LEAF_GREENS[hashIdx(fbx, LEAF_GREENS.length)]); applyLeafWind(m); }
            m.needsUpdate = true;
            return;   // skip the palette-texture path below
          }
        }
        // per-material real texture (prefab -> .mat -> _MainTex); fall back to pack atlas
        const tu = (matMap && matMap[m.name]) || atlasUrl;
        const ppFlat = tu && tu.includes(PP_PALETTE_HASH)
          && (STONE_FAM_RE.test(fbx) ? STONE_GREY : TENT_FAM_RE.test(fbx) ? TENT_TAN : null);
        if (ppFlat != null && ppFlat !== false) {
          // Drop the wrong palette → flat category color (Synty flat-shaded look; normals still shade it).
          m.map = null; m.color.set(ppFlat); if ('metalness' in m) m.metalness = 0;
          if ('emissive' in m && m.emissive) m.emissive.setRGB(0, 0, 0);
          m.needsUpdate = true;
        } else if (tu) {
          m.map = getAtlas(tu); m.color.setRGB(1, 1, 1); if ('metalness' in m) m.metalness = 0;
          if (cutout && cutout.has(tu)) { m.alphaTest = 0.5; m.transparent = false; }  // foliage cutout
          m.needsUpdate = true;
        }
      });
      let geoBox: THREE.Box3 | null = null;
      // Skip player-collision geometry for walk-through scatter (mushrooms etc.) — saves BVH heap + build.
      if ((solid || isRock || isTerrain) && !NO_PLAYER_COLLIDE_RE.test(fbx)) {  // rocks/terrain weren't in the solid list → had NO collider; include them
        if (!src.geometry.boundingBox) src.geometry.computeBoundingBox();
        geoBox = src.geometry.boundingBox;
      }
      const inst = new THREE.InstancedMesh(src.geometry, src.material, matrices.length);
      // `placements` = the original (pre-override) matrices, so the editor can derive a stable
      // key from a clicked instance even after it's been moved.
      inst.userData = { fbx, mesh: meshName ?? '(whole)', combined: !!combined, placements: matrices };
      const hasXform = transformOverrides.size > 0;   // zero cost until something is edited
      for (let i = 0; i < matrices.length; i++) {
        let pArr = matrices[i];
        let hideInst = false;
        if (hasXform) {
          const tov = transformOverrides.get(placeKey(fbx, pArr[12], pArr[13], pArr[14]));
          if (tov) { if (tov.hide) hideInst = true; else if (tov.matrix) pArr = tov.matrix; }
        }
        m.fromArray(pArr).multiply(local);
        if (flipQ) { m.decompose(P, Q, S); Q.premultiply(flipQ); m.compose(P, Q, S); }
        if (hideInst) { m.makeScale(0, 0, 0); inst.setMatrixAt(i, m); continue; }
        inst.setMatrixAt(i, m);
        // Collider from the SAME instance matrix `m` that positions the rendered object →
        // aligned by construction (axis-aligned box around the rotated mesh). Rocks load as a
        // single box too; the player voxelizes specific ones on demand with V (VoxelizeTool),
        // which then OWNS that instance — so skip any instance it manages.
        const ikey = keyFor(fbx, m.elements[12], m.elements[14]);
        if (meshColliders && geoBox) {
          // Player + bullets: the smooth mesh BVH (no invisible walls, no pass-through).
          meshGeos.set(src.geometry.uuid, src.geometry);
          meshInputs.push({ key: src.geometry.uuid, matrix: m.clone(), geoBox });
          // Monsters: greedy boxes in their OWN grid (the player/bullets never read it,
          // so these can't become invisible walls). Denser than the old single box.
          if (!cachedBoxes && !noMonsterColliders && monsterBoxes.length < 4000 && !managedRocks.has(ikey) && !isTerrain) {
            // Terrain: monsters ground on the baked heightfield (MeshHeightmapBaker), NOT voxel boxes
            // (voxelizing a 150 m ground mesh would produce a runaway box count).
            // noMonsterColliders: dense ambient worlds (Enchanted Forest, 18.7k objects) skip the
            // per-instance voxelize entirely — it was the main GC-freeze + retained-Box3 heap source,
            // and these worlds have no monsters (player + bullets still use the mesh BVH).
            // cachedBoxes: a warm load already has this group's boxes — skip the voxelize, apply below.
            for (const b of monsterBoxesFor(src.geometry, m, geoBox, ovCell, organicFine)) monsterBoxes.push(b);
          }
        } else if (geoBox && colliders.length < 2000 && !managedRocks.has(ikey)) {
          // Non-mesh worlds (DreadRoot): single shrunk box / saved voxel as before.
          const ov = colliderOverrides.get(ikey);
          if (ov?.voxel) {
            // Saved authoring: voxelize this instance at the chosen resolution (persists/bakes).
            for (const b of voxelizeGeometry(src.geometry, m, ov.cell, 4000)) colliders.push(b);
          } else {
            const wb = geoBox.clone().applyMatrix4(m);
            const ctr = wb.getCenter(new THREE.Vector3());
            const half = wb.getSize(new THREE.Vector3()).multiplyScalar(shrinkF * 0.5);
            wb.min.copy(ctr).sub(half); wb.max.copy(ctr).add(half);
            colliders.push(wb);
          }
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      out.add(inst);
    }
    // Warm load → use the cached boxes; cold load → record what we just built (debounced save).
    const finalMonsterBoxes = cachedBoxes ?? monsterBoxes;
    if (!cachedBoxes && colliderKey && collSig) recordBoxes(colliderKey, collSig, finalMonsterBoxes);
    return { node: out, colliders, meshInputs, meshGeos, monsterBoxes: finalMonsterBoxes };
  }, [gltf, matrices, rotX, meshName, combined, fbx, atlasUrl, matMap, cutout, meshColliders, ovCell, noMonsterColliders, emissiveBoost, trustMaterials, colliderKey]);
  // Register solid colliders in the engine grid; remove on unmount / world swap.
  useEffect(() => {
    if (!colliders.length) return;
    colliders.forEach((b) => worldCollisionGrid.insert(b));
    return () => colliders.forEach((b) => worldCollisionGrid.remove(b));
  }, [colliders]);
  // Monster-only greedy boxes → the separate grid the player/bullets never read.
  useEffect(() => {
    if (!monsterBoxes.length) return;
    monsterBoxes.forEach((b) => monsterColliderGrid.insert(b));
    return () => monsterBoxes.forEach((b) => monsterColliderGrid.remove(b));
  }, [monsterBoxes]);
  // Register this group's BVH mesh-collider instances; drop them when it streams out.
  // The decimation keep-ratio is stored in the override's `cell` field (1 = full).
  useEffect(() => {
    if (!meshInputs.length) return;
    const ratio = colliderOverrides.get(fbx)?.cell ?? 1;
    for (const [key, geo] of meshGeos) registerMeshGeometry(fbx, key, geo, ratio);
    setGroupInstances(groupId, meshInputs);
    return () => clearGroup(groupId);
  }, [meshInputs, meshGeos, groupId, fbx]);
  return <primitive object={node} />;
}

export function WorldObjectsLayer({ meshColliders = false, dataDir = '/siege/world', placementsFile = 'placements.json', renderDist = 320, foliageDist = 0, maxGroups = 100000, maxInstances = 1e9, trustMaterials = false, noMonsterColliders = false, emissiveBoost = 1, onReady }: { meshColliders?: boolean; dataDir?: string; placementsFile?: string; renderDist?: number; foliageDist?: number; maxGroups?: number; maxInstances?: number; trustMaterials?: boolean; noMonsterColliders?: boolean; emissiveBoost?: number; onReady?: () => void } = {}) {
  const [data, setData] = useState<{ groups: Group[] } | null>(null);
  // Gate the whole mesh-collision system on the world flag (off = fully inert).
  useEffect(() => {
    setMeshCollidersEnabled(meshColliders);
    return () => { setMeshCollidersEnabled(false); clearMeshColliders(); };
  }, [meshColliders]);
  const [atlasMap, setAtlasMap] = useState<Record<string, string>>({});
  const [matMap, setMatMap] = useState<Record<string, Record<string, string>>>({});
  const [cutout, setCutout] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    const oStep = siegeLoadStart('World Objects', 'Loading object placements...');
    const finishObjects = (count?: number) => { siegeLoadFinish(oStep, count); onReady?.(); };
    fetch(`${dataDir}/atlas_map.json`).then((r) => r.json()).then((m) => setAtlasMap(m)).catch(() => {});
    fetch(`${dataDir}/material_map.json`).then((r) => r.json()).then((m) => setMatMap(m)).catch(() => {});
    fetch(`${dataDir}/cutout_textures.json`).then((r) => r.json()).then((a) => setCutout(new Set(a))).catch(() => {});
    // Load collider overrides BEFORE placements (so they apply as groups build their
    // colliders): Supabase shared overrides first (authoritative), then the baked
    // JSON fills any gaps, then placements. Author's localStorage edits (loaded at
    // import) and the DB agree (voxelizing writes both).
    loadColliderOverridesFromDB()
      .catch(() => {})
      .finally(() => {
        fetch(`${dataDir}/collider_overrides.json`)
          .then((r) => (r.ok ? r.json() : []))
          .then((a) => mergeBakedOverrides(a as [string, { voxel: boolean; cell: number }][]))
          .catch(() => {})
          .finally(() => {
            fetch(`${dataDir}/${placementsFile}`).then((r) => r.json())
              .then((d) => { if (alive) setData(d); finishObjects(d?.groups?.length); })
              .catch(() => finishObjects());
          });
      });
    return () => { alive = false; };
  }, [dataDir, placementsFile]);
  // Load this world's cached monster-climb boxes into memory BEFORE any group renders, so each
  // group's synchronous build can read them. Gating the groups on this adds only one quick IDB read.
  const [collReady, setCollReady] = useState(false);
  useEffect(() => {
    let alive = true; setCollReady(false);
    loadColliderCache(dataDir).then(() => { if (alive) setCollReady(true); });
    return () => { alive = false; };
  }, [dataDir]);
  // STREAMING: mount only the object INSTANCES within R of the player (per-instance, so shared
  // rock/grass types don't drag their far-island copies into the beach — that full-map parse was
  // the real fps killer). The load center FOLLOWS the camera, so flying to another island loads
  // its objects (after a brief parse) instead of them never rendering — the bug being fixed.
  // A large move threshold means normal beach play never re-centers (no rebuild hitch); only
  // travelling far does, and a re-center rebuilds the now-near groups (the accepted "delay").
  const camera = useThree((s) => s.camera);
  const [center, setCenter] = useState<[number, number]>([-400, 680]);
  const lastCenter = useRef<[number, number]>([-400, 680]);
  // Start streaming around wherever the player actually spawns (the default beach centre would leave
  // a non-SWW world, e.g. the Apocalypse city, unrendered until you walked 150m).
  useEffect(() => {
    const p = camera.position; lastCenter.current = [p.x, p.z]; setCenter([p.x, p.z]);
  }, [camera]);
  // Re-center the streaming window after the player travels ~half the render radius. Based on
  // renderDist ONLY (NOT the tight foliage bubble): coupling it to a small foliageDist made dense
  // worlds (Enchanted Forest, 18.7k objects) re-center every 30 m, and each re-center rebuilds the
  // near groups — that frequent rebuild was the source of the multi-hundred-ms GC freezes. Min 40 m.
  const recenterD = Math.max(40, 0.5 * renderDist);
  useFrame((_, dt) => {
    windTime.value += dt;                            // drives the leaf-flutter vertex sway
    const dx = camera.position.x - lastCenter.current[0];
    const dz = camera.position.z - lastCenter.current[1];
    if (dx * dx + dz * dz > recenterD * recenterD) {
      lastCenter.current = [camera.position.x, camera.position.z];
      setCenter([camera.position.x, camera.position.z]);
    }
  });
  const allGroups = useMemo(() => (data?.groups ?? []).map((g, i) => ({ ...g, url: resolveModelUrl(g.url), _k: i })), [data]);
  const nearGroups = useMemo(() => {
    const [CX, CZ] = center, R2 = renderDist * renderDist;   // render distance (m), per-map.
    // Foliage (leaves/ferns/grass/undergrowth) is the overdraw killer — cull it at a SHORTER
    // distance than structural objects (trees/rocks/buildings stay visible far off, hidden by fog
    // on pop-in). foliageDist=0 disables the split (uniform renderDist, old behaviour).
    const FR2 = foliageDist > 0 ? foliageDist * foliageDist : R2;
    // Filter instances to within range; track each group's NEAREST instance for prioritising.
    const scored: { g: Group & { _k: number }; near: number[][]; d: number }[] = [];
    for (const g of allGroups) {
      const lim = FOLIAGE_RE.test(g.fbx) ? FR2 : R2;
      let best = Infinity, anyIn = false, allIn = true;
      const near: number[][] = [];
      for (const mx of g.matrices) {
        const dx = mx[12] - CX, dz = mx[14] - CZ; const dd = dx * dx + dz * dz;
        if (dd < best) best = dd;
        if (dd < lim) { near.push(mx); anyIn = true; } else allIn = false;
      }
      if (!anyIn) continue;
      // STABLE REFERENCE when the whole group is in range: reuse the original g.matrices array
      // (identity preserved across re-centers) so GroupInstances' useMemo SKIPS its expensive rebuild
      // (InstancedMesh build + mesh-collider BVH register) for groups whose instances didn't change.
      // The CPU trace showed that per-group rebuild dominating each streaming re-center. Only groups
      // straddling the range boundary (a fresh filtered array) actually rebuild.
      scored.push({ g, near: allIn ? g.matrices : near, d: best });
    }
    scored.sort((a, b) => a.d - b.d);
    // HARD SAFETY BUDGET: cap the number of groups (= simultaneous glTF/draco loads) AND total
    // instances (= geometry/colliders), closest-first. A dense map (the 8000-object Apocalypse city)
    // could otherwise load hundreds of models at once and crash the GPU/tab. Defaults are effectively
    // unlimited so the SWW world is unchanged; the apoc mount passes tight values.
    const out: (Group & { _k: number })[] = [];
    let budget = maxInstances;
    for (const s of scored) {
      if (out.length >= maxGroups || budget <= 0) break;
      const take = s.near.length > budget ? s.near.slice(0, budget) : s.near;
      out.push({ ...s.g, matrices: take });
      budget -= take.length;
    }
    return out;
  }, [allGroups, center, renderDist, foliageDist, maxGroups, maxInstances]);

  if (!data || !collReady) return null;
  return (
    <>
      {nearGroups.map((g) => (
        <Boundary key={g._k}>
          <Suspense fallback={null}>
            <GroupInstances url={g.url} matrices={g.matrices} rotX={g.rotX} meshName={g.mesh} combined={g.combined} fbx={g.fbx} scaleMul={g.scaleMul} whole={g.whole} atlasUrl={atlasMap[g.fbx]} matMap={matMap[g.fbx]} cutout={cutout} meshColliders={meshColliders} trustMaterials={trustMaterials} noMonsterColliders={noMonsterColliders} emissiveBoost={emissiveBoost} colliderKey={dataDir} />
          </Suspense>
        </Boundary>
      ))}
    </>
  );
}
