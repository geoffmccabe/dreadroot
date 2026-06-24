// Hoverbike — a placed SciFi Worlds hover bike at the helipad spot on the SciFi City rooftop. Sits on
// the actual surface (ground-snapped once the city BVH loads). Within 2m the HUD shows a "Requires
// Keycard" prompt (the player can't ride it yet — that's a future feature). Decorative + proximity only.
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { groundAt } from './siegeGround';
import { setHoverbikeInRange } from './hoverbikeStore';

const URL = '/siege/scifi/worlds_SM_Veh_Hover_Bike_02.gltf';
const X = -31.093, Z = -44.667, Y_GUESS = 11.0;   // helipad surface ≈ here; refined by ground-snap below
const YAW = 0;
const RANGE = 2;   // metres (horizontal) from the bike's centre

export function Hoverbike() {
  const { scene } = useGLTF(URL, '/draco/');
  const camera = useThree((s) => s.camera);
  const groupRef = useRef<THREE.Group>(null);
  const grounded = useRef(false);
  useEffect(() => () => setHoverbikeInRange(false), []);   // clear the prompt when leaving the map

  // Clone + sit the lowest point at the group origin (so positioning the group = positioning the base).
  // updateMatrixWorld first so the Synty 0.01 scale + rotation are applied before measuring.
  const obj = useMemo(() => {
    const m = scene.clone(true);
    m.traverse((o) => { o.userData.fbx = 'worlds_SM_Veh_Hover_Bike_02'; });
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m);
    if (!box.isEmpty()) m.position.y = -box.min.y;
    const wrap = new THREE.Group();
    wrap.add(m);
    return wrap;
  }, [scene]);

  useFrame(() => {
    const g = groupRef.current; if (!g) return;
    // Snap onto the actual helipad surface once the BVH is available (city ground loads a bit late).
    if (!grounded.current) {
      const surf = groundAt(X, Z, Y_GUESS + 3);
      g.position.set(X, surf ?? Y_GUESS, Z);
      if (surf != null) grounded.current = true;
    }
    const dx = camera.position.x - X, dz = camera.position.z - Z;
    setHoverbikeInRange(Math.hypot(dx, dz) < RANGE);
  });

  return <group ref={groupRef} position={[X, Y_GUESS, Z]} rotation={[0, YAW, 0]}><primitive object={obj} /></group>;
}

useGLTF.preload(URL, '/draco/');
