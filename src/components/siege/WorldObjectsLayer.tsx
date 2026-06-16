// WorldObjectsLayer — renders the real world from the Unity export (WorldPlacements
// → world/placements.json). Each group = one model's glb + the exact world matrices
// (Unity transform, X-mirrored to match the terrain). Instanced per sub-mesh.
// Per-group error boundary so one bad/missing glb can't take down the world.

import { Component, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { worldCollisionGrid } from '@/lib/spatialHashGrid';
import { managedRocks, keyFor, colliderOverrides, mergeBakedOverrides, loadColliderOverridesFromDB } from './voxelOverrides';
import { registerMeshGeometry, setGroupInstances, clearGroup, setMeshCollidersEnabled, clearMeshColliders, type MeshInstanceInput } from './meshColliderSystem';

let _meshGroupId = 0;
import { voxelizeGeometry } from './voxelize';

interface Group { fbx: string; url: string; matrices: number[][]; rotX?: number; mesh?: string; combined?: boolean; scaleMul?: number; whole?: boolean }

// Which object types get a solid collider (structures, not foliage/clutter you walk through).
const SOLID_RE = /bld|wall|tower|gate|bank|town|cave|colosseum|forge|building|house|hut|barrier|fence|dock|pier|bridge|ruin/i;
const FOLIAGE_RE = /plant|grass|ivy|tree|flower|bush|fern|leaf|vine|reed|seaweed|coral|moss/i;
const isSolidGroup = (fbx: string) => SOLID_RE.test(fbx) && !FOLIAGE_RE.test(fbx);

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

function GroupInstances({ url, matrices, rotX, meshName, combined, fbx, scaleMul, whole, atlasUrl, matMap, cutout, meshColliders }:
  { url: string; matrices: number[][]; rotX?: number; meshName?: string; combined?: boolean; fbx: string; scaleMul?: number; whole?: boolean; atlasUrl?: string; matMap?: Record<string, string>; cutout?: Set<string>; meshColliders?: boolean }) {
  const gltf = useGLTF(url);
  const gidRef = useRef<string | null>(null);
  if (gidRef.current === null) gidRef.current = `mg${_meshGroupId++}`;
  const groupId = gidRef.current;
  // This MODEL is flagged for a true mesh collider (per-model, all copies).
  const useMesh = !!meshColliders && !!colliderOverrides.get(fbx)?.mesh;
  const { node, colliders, meshInputs, meshGeos } = useMemo(() => {
    const out = new THREE.Group();
    const colliders: THREE.Box3[] = [];
    const meshInputs: MeshInstanceInput[] = [];
    const meshGeos = new Map<string, THREE.BufferGeometry>();
    const solid = isSolidGroup(fbx);
    // Mesh-AABBs run loose; shrink toward the real object size. Rocks are the worst (organic
    // shapes in a big box) → 60%; everything else → 80%.
    const isRock = /rock|stone|boulder|cliff|mountain/i.test(fbx);
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
        // per-material real texture (prefab -> .mat -> _MainTex); fall back to pack atlas
        const tu = (matMap && matMap[m.name]) || atlasUrl;
        if (tu) {
          m.map = getAtlas(tu); m.color.setRGB(1, 1, 1); if ('metalness' in m) m.metalness = 0;
          if (cutout && cutout.has(tu)) { m.alphaTest = 0.5; m.transparent = false; }  // foliage cutout
          m.needsUpdate = true;
        }
      });
      let geoBox: THREE.Box3 | null = null;
      if (solid || isRock) {  // rocks weren't in the solid list → had NO collider; include them
        if (!src.geometry.boundingBox) src.geometry.computeBoundingBox();
        geoBox = src.geometry.boundingBox;
      }
      const inst = new THREE.InstancedMesh(src.geometry, src.material, matrices.length);
      inst.userData = { fbx, mesh: meshName ?? '(whole)', combined: !!combined };
      for (let i = 0; i < matrices.length; i++) {
        m.fromArray(matrices[i]).multiply(local);
        if (flipQ) { m.decompose(P, Q, S); Q.premultiply(flipQ); m.compose(P, Q, S); }
        inst.setMatrixAt(i, m);
        // Collider from the SAME instance matrix `m` that positions the rendered object →
        // aligned by construction (axis-aligned box around the rotated mesh). Rocks load as a
        // single box too; the player voxelizes specific ones on demand with V (VoxelizeTool),
        // which then OWNS that instance — so skip any instance it manages.
        const ikey = keyFor(fbx, m.elements[12], m.elements[14]);
        if (useMesh && geoBox) {
          // True mesh collider: feed the BVH system this instance; NO box collider.
          meshGeos.set(src.geometry.uuid, src.geometry);
          meshInputs.push({ key: src.geometry.uuid, matrix: m.clone(), geoBox });
        } else if (geoBox && colliders.length < 2000 && !managedRocks.has(ikey)) {
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
    return { node: out, colliders, meshInputs, meshGeos };
  }, [gltf, matrices, rotX, meshName, combined, fbx, atlasUrl, matMap, cutout, useMesh]);
  // Register solid colliders in the engine grid; remove on unmount / world swap.
  useEffect(() => {
    if (!colliders.length) return;
    colliders.forEach((b) => worldCollisionGrid.insert(b));
    return () => colliders.forEach((b) => worldCollisionGrid.remove(b));
  }, [colliders]);
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

export function WorldObjectsLayer({ meshColliders = false }: { meshColliders?: boolean } = {}) {
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
    fetch('/siege/world/atlas_map.json').then((r) => r.json()).then((m) => setAtlasMap(m)).catch(() => {});
    fetch('/siege/world/material_map.json').then((r) => r.json()).then((m) => setMatMap(m)).catch(() => {});
    fetch('/siege/world/cutout_textures.json').then((r) => r.json()).then((a) => setCutout(new Set(a))).catch(() => {});
    // Load collider overrides BEFORE placements (so they apply as groups build their
    // colliders): Supabase shared overrides first (authoritative), then the baked
    // JSON fills any gaps, then placements. Author's localStorage edits (loaded at
    // import) and the DB agree (voxelizing writes both).
    loadColliderOverridesFromDB()
      .catch(() => {})
      .finally(() => {
        fetch('/siege/world/collider_overrides.json')
          .then((r) => (r.ok ? r.json() : []))
          .then((a) => mergeBakedOverrides(a as [string, { voxel: boolean; cell: number }][]))
          .catch(() => {})
          .finally(() => {
            fetch('/siege/world/placements.json').then((r) => r.json())
              .then((d) => alive && setData(d)).catch(() => {});
          });
      });
    return () => { alive = false; };
  }, []);
  // STREAMING: mount only the object INSTANCES within R of the player (per-instance, so shared
  // rock/grass types don't drag their far-island copies into the beach — that full-map parse was
  // the real fps killer). The load center FOLLOWS the camera, so flying to another island loads
  // its objects (after a brief parse) instead of them never rendering — the bug being fixed.
  // A large move threshold means normal beach play never re-centers (no rebuild hitch); only
  // travelling far does, and a re-center rebuilds the now-near groups (the accepted "delay").
  const camera = useThree((s) => s.camera);
  const [center, setCenter] = useState<[number, number]>([-400, 680]);
  const lastCenter = useRef<[number, number]>([-400, 680]);
  useFrame(() => {
    const dx = camera.position.x - lastCenter.current[0];
    const dz = camera.position.z - lastCenter.current[1];
    if (dx * dx + dz * dz > 150 * 150) {            // re-center only after ~150m of travel
      lastCenter.current = [camera.position.x, camera.position.z];
      setCenter([camera.position.x, camera.position.z]);
    }
  });
  const allGroups = useMemo(() => (data?.groups ?? []).map((g, i) => ({ ...g, _k: i })), [data]);
  const nearGroups = useMemo(() => {
    const [CX, CZ] = center, R2 = 260 * 260;        // ~match the fog distance + a margin
    const out: (Group & { _k: number })[] = [];
    for (const g of allGroups) {
      const near = g.matrices.filter((mx) => {
        const dx = mx[12] - CX, dz = mx[14] - CZ;
        return dx * dx + dz * dz < R2;
      });
      if (near.length) out.push({ ...g, matrices: near });
    }
    return out;
  }, [allGroups, center]);

  if (!data) return null;
  return (
    <>
      {nearGroups.map((g) => (
        <Boundary key={g._k}>
          <Suspense fallback={null}>
            <GroupInstances url={g.url} matrices={g.matrices} rotX={g.rotX} meshName={g.mesh} combined={g.combined} fbx={g.fbx} scaleMul={g.scaleMul} whole={g.whole} atlasUrl={atlasMap[g.fbx]} matMap={matMap[g.fbx]} cutout={cutout} meshColliders={meshColliders} />
          </Suspense>
        </Boundary>
      ))}
    </>
  );
}
