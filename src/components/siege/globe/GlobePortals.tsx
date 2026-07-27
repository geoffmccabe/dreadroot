// GlobePortals — one portal per Divi node location, on the Mini Earth.
//
// This is the hook that makes the game a Divi product rather than a game with a crypto skin: the
// board is decided by where people actually run nodes. No node, no portal, no foothold.
//
// The registry is a snapshot published to R2 by scripts/earth/build_node_portals.py, taken from
// the 30-day rolling peer list DD69 already maintains. It carries an opaque id, a coarse location
// and a city label; node IP addresses never reach the client.
//
// RENDERING AT PLANETARY SCALE is the interesting constraint. A portal has to be findable from
// 160,000 units away in orbit AND look like a structure when you are standing next to it at 300 m
// tall. A fixed-size mesh fails at one end or the other, so the beam scales with distance to the
// camera: it holds a roughly constant angular size far away, acting as a map marker, and settles
// to a real physical size once you are close. Instanced into two draw calls regardless of how many
// portals exist, since the node count is expected to grow.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ASSET_BASE } from '@/config/assetBase';
import { PLANET_RADIUS, METRES_PER_UNIT, latLonToDirection } from './cubeSphere';
import { sampleGlobeSurface } from './globeGround';

export interface Portal {
  id: string;
  lat: number;
  lon: number;
  city: string | null;
  cc: string | null;
  /** How many nodes share this location. Busier sites read brighter and taller. */
  nodes: number;
}

/** Physical height of a portal beam at close range, in game units (1 unit = 100 m). */
const BEAM_UNITS = 12;
/** Minimum angular size far away, so a portal stays visible from orbit. */
const MIN_ANGULAR = 0.010;
/** Cap on how much the beam may be inflated, so it never swamps the planet. */
const MAX_SCALE = 900;

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

/** Portal world positions, resolved against the terrain so they sit ON the ground. */
export function portalPositions(list: Portal[]): { portal: Portal; pos: THREE.Vector3; up: THREE.Vector3 }[] {
  const dir = new Float64Array(3);
  return list.map((portal) => {
    latLonToDirection(portal.lat, portal.lon, dir);
    const up = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const m = sampleGlobeSurface(up.x, up.y, up.z);
    // Portals in the sea sit at sea level rather than on the seabed: they are gateways, not
    // buildings, and a beam rising out of open ocean is the intended look.
    const groundM = m == null ? 0 : Math.max(0, m);
    const r = PLANET_RADIUS + groundM / METRES_PER_UNIT;
    return { portal, pos: up.clone().multiplyScalar(r), up };
  });
}

export function GlobePortals() {
  const camera = useThree((s) => s.camera);
  const [portals, setPortals] = useState<Portal[]>([]);
  const beamRef = useRef<THREE.InstancedMesh>(null);
  const baseRef = useRef<THREE.InstancedMesh>(null);
  const placed = useRef<{ portal: Portal; pos: THREE.Vector3; up: THREE.Vector3 }[]>([]);
  const regrounded = useRef(false);

  useEffect(() => { loadPortals().then(setPortals); }, []);

  const beamGeo = useMemo(() => {
    // Cone pointing up its local +Y, origin at the base.
    const g = new THREE.ConeGeometry(0.16, 1, 6, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const baseGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 0.08, 12);
    g.translate(0, 0.04, 0);
    return g;
  }, []);

  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.35, 0.85, 1.0),
    transparent: true, opacity: 0.55, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), []);
  const baseMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.15, 0.55, 0.9), fog: false, transparent: true, opacity: 0.9,
  }), []);

  useEffect(() => {
    if (!portals.length) return;
    placed.current = portalPositions(portals);
    regrounded.current = false;
  }, [portals]);

  useEffect(() => () => {
    beamGeo.dispose(); baseGeo.dispose(); beamMat.dispose(); baseMat.dispose();
  }, [beamGeo, baseGeo, beamMat, baseMat]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const UP = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    const beam = beamRef.current, base = baseRef.current;
    if (!beam || !base || !placed.current.length) return;

    // Terrain streams in after the portals are first placed, so re-resolve their ground height
    // once tiles are available. Without this they sit at sea level over land forever.
    if (!regrounded.current && placed.current.length) {
      const p0 = placed.current[0];
      if (sampleGlobeSurface(p0.up.x, p0.up.y, p0.up.z) != null) {
        placed.current = portalPositions(placed.current.map((p) => p.portal));
        regrounded.current = true;
      }
    }

    for (let i = 0; i < placed.current.length; i++) {
      const { portal, pos, up } = placed.current[i];
      const dist = camera.position.distanceTo(pos);

      // Angular sizing: keep a floor on apparent size so a portal is still a visible mark from
      // orbit, then let it settle to its true physical height as you approach.
      const wanted = Math.max(BEAM_UNITS, dist * MIN_ANGULAR);
      const scale = Math.min(BEAM_UNITS * MAX_SCALE, wanted);
      const busy = 1 + Math.min(1.4, Math.log2(1 + portal.nodes) * 0.35);

      q.setFromUnitVectors(UP, up);
      dummy.position.copy(pos);
      dummy.quaternion.copy(q);
      dummy.scale.set(scale * 0.5 * busy, scale * busy, scale * 0.5 * busy);
      dummy.updateMatrix();
      beam.setMatrixAt(i, dummy.matrix);

      dummy.scale.set(scale * busy, scale * 0.25 * busy, scale * busy);
      dummy.updateMatrix();
      base.setMatrixAt(i, dummy.matrix);
    }
    beam.count = placed.current.length;
    base.count = placed.current.length;
    beam.instanceMatrix.needsUpdate = true;
    base.instanceMatrix.needsUpdate = true;
  });

  if (!portals.length) return null;
  return (
    <group name="globe-portals">
      <instancedMesh ref={baseRef} args={[baseGeo, baseMat, portals.length]} frustumCulled={false} />
      <instancedMesh ref={beamRef} args={[beamGeo, beamMat, portals.length]} frustumCulled={false} renderOrder={3} />
    </group>
  );
}
