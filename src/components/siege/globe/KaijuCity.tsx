// KaijuCity — Dubai, as forty thousand boxes in one draw call.
//
// PHASE 1 of docs/KAIJU_CITY_PLAN.md: the city exists, in the right place, at the right scale, with
// the right silhouette. No windows, no lights, no colliders, no destruction — those are phases 2, 3
// and 4, and doing them before the shapes are proven correct would mean debugging four things at
// once.
//
// EVERYTHING HANGS OFF ONE GROUP, and that is not tidiness, it is arithmetic. See the long note in
// cityData.ts: at 63,710 units from the world origin a float32 can only resolve about 0.4 m, so
// buildings placed in world coordinates would shimmer and z-fight against each other. Inside a group
// that already carries the big offset, every building is a few kilometres from ITS origin, where the
// same float has millimetre precision going spare.
//
// The instance matrices are written ONCE, at load. Buildings do not move — until one is knocked
// down, which is phase 4's problem and will rewrite only the rows that changed.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { setBuildingSteer } from './kaijuArena';
import { steerKaijuAroundBuildings } from './cityColliders';
import { METRES_PER_UNIT } from './cubeSphere';
import { loadCity, getCity, cityDistanceUnits, cityDiag, type City } from './cityData';
import { citySites, currentSite, subscribeSite, siteVersion } from './sites';
import { applyCityWindows } from './cityWindows';
import { KaijuCityLights } from './KaijuCityLights';
import { KaijuCityRoads } from './KaijuCityRoads';
import { KaijuCityWater } from './KaijuCityWater';
import { KaijuCityDetail } from './KaijuCityDetail';
import { KaijuCityBridges } from './KaijuCityBridges';

/**
 * Beyond this the city is not drawn at all.
 *
 * 400 units is 40 km — comfortably past the far side of every district, so the skyline is complete
 * from anywhere you would fight, and gone by the time you are in orbit. Forty thousand boxes is
 * cheap to draw and not free, and from space it is a smudge two pixels across.
 */
const DRAW_WITHIN_UNITS = 400;

export function KaijuCity() {
  // HAND THE ARENA ITS BUILDING AVOIDANCE while a city is mounted, and take it away again when it
  // is not. Pushed in rather than imported by the arena, because the collider index reaches the
  // database through cityData and the simulation must not — importing it there dragged the Supabase
  // client into every headless check and broke all of them at load.
  useEffect(() => {
    setBuildingSteer(steerKaijuAroundBuildings);
    return () => setBuildingSteer(null);
  }, []);

  // WHICH CITY FOLLOWS WHERE YOU ARE. Re-reading the registry on every site change is what makes a
  // second city work at all: with a hard-coded first entry, B4 would load Dubai's buildings and
  // stand them on the wrong continent — which would look like a placement bug rather than the
  // wiring one it is.
  useSyncExternalStore(subscribeSite, siteVersion, siteVersion);
  const site = currentSite();
  // Before you have gone anywhere, fall back to the first city on the registry so its assets warm
  // up rather than waiting for a keypress.
  const slug = (site?.city ? site.slug : null) ?? citySites()[0]?.slug ?? null;

  const [city, setCity] = useState<City | null>(getCity());
  useEffect(() => {
    if (!slug) { setCity(null); return; }
    let alive = true;
    void loadCity(slug).then((c) => { if (alive) setCity(c); });
    return () => { alive = false; };
  }, [slug]);

  if (!city || !slug) return null;
  // KEYED BY SLUG, so moving to another city rebuilds the mesh rather than trying to reuse instance
  // buffers sized for a different number of buildings.
  return <CityMesh key={slug} city={city} slug={slug} />;
}

function CityMesh({ city, slug }: { city: City; slug: string }) {
  // The registry entry, so the asset paths, the draw distance and the beacon height all come from
  // the site rather than from constants scattered through the renderers.
  const site = citySites().find((s) => s.slug === slug);
  /** The height the group itself sits at; per-building grounds are offsets from it. */
  const refGroundM = site?.ground.groundMetres ?? 0;
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.InstancedMesh>(null);

  const count = city.buildings.length;

  // A unit cube whose ORIGIN IS ITS BASE, not its centre.
  //
  // Translating the geometry once here means every instance matrix is (position on the ground,
  // rotation, size) with no half-height correction — and, more usefully, phase 4 can shorten a
  // building by scaling Y alone and it will sink into its own footprint rather than into the
  // ground. Doing it per instance instead would be forty thousand extra additions and a
  // correction that has to be remembered at every future call site.
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  /** Shared clock for the window shader. A uniform object, so it survives shader recompiles. */
  const timeRef = useRef({ value: 0 });

  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({
      color: 0x9aa3ad,
      // NOT `vertexColors`. An InstancedMesh's per-instance colours come from `instanceColor`, which
      // three enables on its own the moment setColorAt is called. `vertexColors` is a different
      // feature that expects a `color` attribute ON THE GEOMETRY — which a BoxGeometry does not have,
      // so the shader would read a missing attribute as zero and draw the entire city black.
    });
    // PHASE 2: the facades. A window grid computed from each building's real size, so a 522 m tower
    // gets 130 storeys and a villa gets two, and every window is the same size in metres across the
    // whole city. No texture is loaded — see cityWindows.ts for why a tiled one cannot work here.
    applyCityWindows(m, timeRef.current);
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    const U = 1 / METRES_PER_UNIT;

    // The window shader needs each building's REAL SIZE IN METRES, which the instance matrix has
    // but a fragment shader cannot recover from it (the matrix arrives as a transform, and undoing
    // an arbitrary rotation to get the scale back out costs more than sending three floats). A seed
    // rides along so two identical towers do not get identical window patterns.
    const sizes = new Float32Array(count * 3);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const b = city.buildings[i];
      sizes[i * 3] = b.w; sizes[i * 3 + 1] = b.h; sizes[i * 3 + 2] = b.d;
      seeds[i] = ((i * 2654435761) % 1024) / 1024;
      // EACH BUILDING ON ITS OWN GROUND. The group's origin sits at the city's reference height, so
      // a building whose measured ground differs from it is offset by the difference. Without this
      // the whole city is one plane and Seattle's hills and San Jose's valley are levelled — which
      // is exactly what Geoff saw.
      dummy.position.set(b.x * U, b.g == null ? 0 : (b.g - refGroundM) * U, b.z * U);
      // NEGATIVE rot. The bake stores the angle in a (east, south) plane, and a rotation about the
      // local +Y axis carries +X toward -Z — the opposite way round. Getting this wrong mirrors
      // every building's orientation, which on a grid city reads as "almost right" and is exactly
      // the sort of thing that survives a look.
      dummy.rotation.set(0, -b.rot, 0);
      dummy.scale.set(b.w * U, b.h * U, b.d * U);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);

      // A little variation so the city is not one flat plate of grey. Concrete, sand-stone and
      // glass-blue, chosen by a hash of the building's own size so it is stable across reloads.
      const t = ((b.x * 7919 + b.z * 104729) % 1000 + 1000) % 1000 / 1000;
      const tall = Math.min(1, b.h / 200);
      // Taller buildings skew glassier and cooler; low-rise skews sandy. Roughly true of Dubai.
      colour.setHSL(0.08 + 0.5 * tall * (0.4 + 0.6 * t), 0.05 + 0.10 * t, 0.42 + 0.22 * t);
      m.setColorAt(i, colour);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.geometry.setAttribute('iSize', new THREE.InstancedBufferAttribute(sizes, 3));
    m.geometry.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    // Computed from the instances rather than the unit cube, or the whole city would vanish the
    // moment the group's own origin left the frustum.
    m.computeBoundingSphere();
    console.log(`[city] placed ${count.toLocaleString()} buildings`);
  }, [city, count]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.position.copy(city.position);
    g.quaternion.copy(city.quaternion);
  }, [city]);

  // Drawn only when you are near enough for it to be a city rather than a smudge.
  //
  // WRAPPED, AND THE REASON MATTERS. An error boundary catches a throw during RENDER; it cannot
  // catch one inside a frame callback. A frame callback that throws takes react-three-fiber's loop
  // with it — so every OTHER callback stops too, including the one that drives the camera and the
  // one that moves the Kaiju. The symptom is "I can't move and the camera doesn't move either",
  // which points at the controls and never at the decorative layer that actually did it.
  //
  // The city is scenery. It is never worth freezing the game for, so it fails once, says so, and
  // stops trying.
  const broken = useRef(false);
  const [near, setNear] = useState(false);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g || broken.current) return;
    try {
      timeRef.current.value += dt;
      const visible = cityDistanceUnits(camera.position) < DRAW_WITHIN_UNITS;
      g.visible = visible;
      // The moving lights only mount when you are close enough for them to be lights rather than a
      // sub-pixel shimmer — 900 points updated on the CPU is not free, and from orbit it is nine
      // hundred points of nothing.
      if (visible !== near) setNear(visible);
    } catch (err) {
      broken.current = true;
      g.visible = false;
      console.error('[city] hidden after a frame error', err);
    }
  });

  return (
    <group ref={group}>
      <instancedMesh
        ref={mesh}
        args={[geometry, material, count]}
        frustumCulled={false}
      />
      {/* The street network. Inside the same group as the buildings, so it inherits the tangent
          frame and the float precision that comes with it — a road placed in world coordinates at
          63,710 units from the origin would shimmer against the buildings it runs between. */}
      {near && <KaijuCityRoads slug={slug} />}
      {/* The Marina's channels, the Burj Lake, the Creek — drawn as their own surface because the
          terrain mesh cannot resolve a 120 m canal and the planet's ocean is nearly clear at that
          depth. */}
      {near && site?.city?.assets.water && <KaijuCityWater slug={slug} />}
      {/* The 1,214 buildings OSM describes in 3D — spires, domes, setbacks, and all 828 m of the
          Burj Khalifa. Their boxes have been removed from the bake above, so nothing overlaps. */}
      {near && site?.city?.assets.detail && <KaijuCityDetail slug={slug} refGroundM={refGroundM} />}
      {/* The river crossings, lifted off the water. Without this they are part of the road network
          and get painted flat on it. */}
      {near && site?.city?.assets.bridges && <KaijuCityBridges slug={slug} refGroundM={refGroundM} />}
      {/* Traffic on those roads, and the red lamps on the roofs over 180 m. */}
      {near && <KaijuCityLights city={city} slug={slug} />}
    </group>
  );
}
