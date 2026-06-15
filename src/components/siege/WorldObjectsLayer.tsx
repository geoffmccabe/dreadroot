// WorldObjectsLayer — renders the real world from the Unity export (WorldPlacements
// → world/placements.json). Each group = one model's glb + the exact world matrices
// (Unity transform, X-mirrored to match the terrain). Instanced per sub-mesh.
// Per-group error boundary so one bad/missing glb can't take down the world.

import { Component, ReactNode, Suspense, useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

interface Group { fbx: string; url: string; matrices: number[][]; rotX?: number; mesh?: string; combined?: boolean; scaleMul?: number; whole?: boolean }

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

function GroupInstances({ url, matrices, rotX, meshName, combined, fbx, scaleMul, whole, atlasUrl, matMap, cutout }:
  { url: string; matrices: number[][]; rotX?: number; meshName?: string; combined?: boolean; fbx: string; scaleMul?: number; whole?: boolean; atlasUrl?: string; matMap?: Record<string, string>; cutout?: Set<string> }) {
  const gltf = useGLTF(url);
  const node = useMemo(() => {
    const out = new THREE.Group();
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
    // Combined bakes lack the +90° X axis-conversion the single-mesh kit nodes carry.
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
        // Export matrix already holds world position+rotation: use ONLY scale + axis-fix.
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
      const inst = new THREE.InstancedMesh(src.geometry, src.material, matrices.length);
      inst.userData = { fbx, mesh: meshName ?? '(whole)', combined: !!combined };
      for (let i = 0; i < matrices.length; i++) {
        m.fromArray(matrices[i]).multiply(local);
        if (flipQ) { m.decompose(P, Q, S); Q.premultiply(flipQ); m.compose(P, Q, S); }
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      out.add(inst);
    }
    return out;
  }, [gltf, matrices, rotX, meshName, combined, fbx, atlasUrl, matMap, cutout]);
  return <primitive object={node} />;
}

export function WorldObjectsLayer() {
  const [data, setData] = useState<{ groups: Group[] } | null>(null);
  const [atlasMap, setAtlasMap] = useState<Record<string, string>>({});
  const [matMap, setMatMap] = useState<Record<string, Record<string, string>>>({});
  const [cutout, setCutout] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    fetch('/siege/world/atlas_map.json').then((r) => r.json()).then((m) => setAtlasMap(m)).catch(() => {});
    fetch('/siege/world/material_map.json').then((r) => r.json()).then((m) => setMatMap(m)).catch(() => {});
    fetch('/siege/world/cutout_textures.json').then((r) => r.json()).then((a) => setCutout(new Set(a))).catch(() => {});
    fetch('/siege/world/placements.json').then((r) => r.json())
      .then((d) => alive && setData(d)).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return null;
  return (
    <>
      {data.groups.map((g, i) => (
        <Boundary key={i}>
          <Suspense fallback={null}>
            <GroupInstances url={g.url} matrices={g.matrices} rotX={g.rotX} meshName={g.mesh} combined={g.combined} fbx={g.fbx} scaleMul={g.scaleMul} whole={g.whole} atlasUrl={atlasMap[g.fbx]} matMap={matMap[g.fbx]} cutout={cutout} />
          </Suspense>
        </Boundary>
      ))}
    </>
  );
}
