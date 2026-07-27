// GlobePortals — the SWW lobby warpgate, one per Divi node, clustered at each node location.
//
// This is the hook that makes the game a Divi product rather than a game with a crypto skin: the
// board is decided by where people actually run nodes. No node, no portal, no foothold.
//
// The registry is a snapshot published to R2 by scripts/earth/build_node_portals.py, from the
// 30-day rolling peer list DD69 already maintains. It carries an opaque id, a coarse location and
// a city label; node IP addresses never reach the client.
//
// CLUSTER GEOMETRY (Geoff's spec). One node is a single gate. Two face each other with their ramps
// pointing away. Three make a triangle, four a plus, five or more a pentagon, hexagon and so on,
// with the ring growing as nodes are added, so Dallas at 15 nodes becomes a large ring you fly
// into. Those are all the same rule: a regular n-gon with every gate facing the centre and its
// ramp pointing outward. "Two facing each other" is just the n=2 case, and "a plus" the n=4 case,
// so one formula covers the lot rather than four special cases.
//
// SCALE. The gate renders 6.83 units tall in the SWW lobby (830x683x827 model units at the root
// node's 0.01 scale). Here it is scaled to 10 units, i.e. 1,000 m, so a 300-500 m Kaiju walks
// through it with clearance rather than stepping over it.
//
// RENDERING AT PLANETARY SCALE. A cluster must be findable from 160,000 units in orbit and read as
// architecture when you stand beside it. The gates themselves stay at true physical size, and a
// separate marker beam holds a minimum ANGULAR size so the site is visible from space. Everything
// is instanced, so the cost is a couple of draw calls no matter how many nodes join.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { ASSET_BASE } from '@/config/assetBase';
import { PLANET_RADIUS, METRES_PER_UNIT, latLonToDirection } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';

const GATE_URL = `${ASSET_BASE}/siege/scifi/meadow_SM_Bld_Warpgate_01.glb`;

/** Target gate height in game units. 10 u = 1,000 m, per Geoff. */
const GATE_HEIGHT_UNITS = 10;
/** Measured rendered height of the source model (model 682.94 units x 0.01 root scale). */
const MODEL_HEIGHT_UNITS = 6.8294;
/** Measured rendered width, used to space the ring so gates never intersect. */
const MODEL_WIDTH_UNITS = 8.3069;
/** Gap between neighbouring gates, as a multiple of gate width. */
const RING_SPACING = 1.55;
/** Never build a ring tighter than this many gate widths in radius. */
const MIN_RING_WIDTHS = 1.15;
/** Cap on gates drawn per site, so one enormous datacentre cannot dominate the frame budget. */
const MAX_GATES_PER_SITE = 24;

/** Marker beam: minimum angular size so a site is findable from orbit. */
const MARKER_MIN_ANGULAR = 0.008;
const MARKER_MAX_SCALE = 1200;

export interface Portal {
  id: string;
  lat: number;
  lon: number;
  city: string | null;
  cc: string | null;
  /** How many nodes share this location. Sets how many gates the ring has. */
  nodes: number;
}

let cache: Portal[] | null = null;
let inflight: Promise<Portal[]> | null = null;

export function loadPortals(): Promise<Portal[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(`${ASSET_BASE}/siege/earth/portals.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`portals ${r.status}`))))
      .then((d) => { cache = (d.portals ?? []) as Portal[]; return cache; })
      .catch((e) => { inflight = null; console.warn('[earth] portals unavailable', e); return []; });
  }
  return inflight;
}

export interface GateInstance { matrix: THREE.Matrix4; site: THREE.Vector3 }

/** Ring radius in units for `n` gates: big enough that neighbours never intersect. */
export function ringRadius(n: number): number {
  const gateW = MODEL_WIDTH_UNITS * (GATE_HEIGHT_UNITS / MODEL_HEIGHT_UNITS);
  if (n <= 1) return 0;
  // Circumference must fit n gates with spacing between them.
  const byCircumference = (n * gateW * RING_SPACING) / (2 * Math.PI);
  return Math.max(gateW * MIN_RING_WIDTHS, byCircumference);
}

/**
 * Build the gate transforms for one site.
 *
 * Every gate stands on the terrain with its local +Y along the surface normal, and its local +Z
 * pointing at the ring centre, which puts the ramp (which extends along model -Z) outward.
 */
export function buildSite(p: Portal, out: GateInstance[]): void {
  const n = Math.max(1, Math.min(MAX_GATES_PER_SITE, p.nodes));
  const scale = GATE_HEIGHT_UNITS / MODEL_HEIGHT_UNITS;

  const d = new Float64Array(3);
  latLonToDirection(p.lat, p.lon, d);
  const up = new THREE.Vector3(d[0], d[1], d[2]).normalize();

  // Tangent frame at the site. Any pair will do; the ring is rotationally symmetric anyway.
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();

  const centreM = sampleGlobeSurface(up.x, up.y, up.z);
  const centreR = PLANET_RADIUS + Math.max(0, centreM ?? 0) / METRES_PER_UNIT;
  const centre = up.clone().multiplyScalar(centreR);

  const R = ringRadius(n);
  const xAxis = new THREE.Vector3(), zAxis = new THREE.Vector3(), yAxis = new THREE.Vector3();
  const pos = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    if (n === 1) {
      pos.copy(centre);
      zAxis.copy(north);          // a lone gate faces local north; nothing to face toward
    } else {
      const a = (i / n) * Math.PI * 2;
      const off = east.clone().multiplyScalar(Math.cos(a) * R)
        .addScaledVector(north, Math.sin(a) * R);
      pos.copy(centre).add(off);
      // Re-ground each gate individually: a 4 km ring can span real relief.
      const gd = pos.clone().normalize();
      const gm = sampleGlobeSurface(gd.x, gd.y, gd.z);
      pos.copy(gd).multiplyScalar(PLANET_RADIUS + Math.max(0, gm ?? 0) / METRES_PER_UNIT);
      // Face the ring centre: ramp (model -Z) therefore points outward.
      zAxis.copy(centre).sub(pos);
      yAxis.copy(gd);
      zAxis.addScaledVector(yAxis, -zAxis.dot(yAxis));   // flatten onto the local ground
      if (zAxis.lengthSq() < 1e-8) zAxis.copy(north);
      zAxis.normalize();
    }
    yAxis.copy(pos).normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();        // right-handed: X = Y x Z
    zAxis.crossVectors(xAxis, yAxis).normalize();        // re-orthogonalise

    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    m.scale(new THREE.Vector3(scale, scale, scale));
    m.setPosition(pos);
    out.push({ matrix: m, site: centre.clone() });
  }
}

export function GlobePortals() {
  const camera = useThree((s) => s.camera);
  const [portals, setPortals] = useState<Portal[]>([]);
  const { scene: gateScene } = useGLTF(GATE_URL);
  const groupRef = useRef<THREE.Group>(null);
  const instances = useRef<GateInstance[]>([]);
  const built = useRef(false);
  const markerRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => { loadPortals().then(setPortals); }, []);

  /** One InstancedMesh per sub-mesh of the gate, so the whole model instances in 2-3 draw calls. */
  const subMeshes = useMemo(() => {
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    gateScene.updateMatrixWorld(true);
    gateScene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Bake each sub-mesh's transform relative to the model root, so instancing one matrix per
      // gate reproduces the assembled model rather than a pile of parts at the origin.
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      const mat = (mesh.material as THREE.Material).clone();
      (mat as THREE.MeshStandardMaterial).fog = false;
      out.push({ geometry: geo, material: mat });
    });
    return out;
  }, [gateScene]);

  const markerGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.10, 1, 6, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const markerMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.4, 0.9, 1.0), transparent: true, opacity: 0.4,
    depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), []);

  useEffect(() => () => {
    subMeshes.forEach((s) => { s.geometry.dispose(); s.material.dispose(); });
    markerGeo.dispose(); markerMat.dispose();
  }, [subMeshes, markerGeo, markerMat]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const UP = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    if (!portals.length || !groupRef.current) return;

    // Terrain streams in after the registry loads, so build the transforms once ground heights
    // are actually available; otherwise every gate sits at sea level, buried or floating.
    if (!built.current) {
      const d = new Float64Array(3);
      latLonToDirection(portals[0].lat, portals[0].lon, d);
      if (sampleGlobeSurface(d[0], d[1], d[2]) == null) return;
      const list: GateInstance[] = [];
      for (const p of portals) buildSite(p, list);
      instances.current = list;
      built.current = true;

      groupRef.current.clear();
      for (const sm of subMeshes) {
        const im = new THREE.InstancedMesh(sm.geometry, sm.material, list.length);
        im.frustumCulled = false;
        for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i].matrix);
        im.instanceMatrix.needsUpdate = true;
        groupRef.current.add(im);
      }
    }

    // Marker beams keep each SITE findable from orbit; the gates themselves stay true size.
    const marker = markerRef.current;
    if (marker && instances.current.length) {
      let i = 0;
      const seen = new Set<string>();
      for (const p of portals) {
        const d = new Float64Array(3);
        latLonToDirection(p.lat, p.lon, d);
        const up = new THREE.Vector3(d[0], d[1], d[2]).normalize();
        const m = sampleGlobeSurface(up.x, up.y, up.z);
        const pos = up.clone().multiplyScalar(PLANET_RADIUS + Math.max(0, m ?? 0) / METRES_PER_UNIT);
        const dist = camera.position.distanceTo(pos);
        const scale = Math.min(GATE_HEIGHT_UNITS * MARKER_MAX_SCALE,
          Math.max(GATE_HEIGHT_UNITS * 2, dist * MARKER_MIN_ANGULAR));
        q.setFromUnitVectors(UP, up);
        dummy.position.copy(pos);
        dummy.quaternion.copy(q);
        dummy.scale.set(scale * 0.5, scale, scale * 0.5);
        dummy.updateMatrix();
        marker.setMatrixAt(i++, dummy.matrix);
        seen.add(p.id);
      }
      marker.count = i;
      marker.instanceMatrix.needsUpdate = true;
    }
  });

  if (!portals.length) return null;
  return (
    <group name="globe-portals">
      <group ref={groupRef} />
      <instancedMesh ref={markerRef} args={[markerGeo, markerMat, portals.length]}
                     frustumCulled={false} renderOrder={3} />
    </group>
  );
}

useGLTF.preload(GATE_URL);
