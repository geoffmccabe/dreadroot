// Image-based lighting (IBL): a cheap, no-network environment map that gives PBR
// materials (monsters, glass blocks, emissive blocks) believable ambient form and a
// hint of reflection — instead of the flat, uniform hemisphere ambient.
//
// RoomEnvironment is a neutral procedural light-rig (a few area lights in a box). We
// pre-filter it once with PMREMGenerator and hand it to scene.environment. Lambert
// world blocks ignore environment maps, so this has ZERO cost on the bulk of the scene
// and only lifts the handful of Standard/Physical materials. Runs once on mount.
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useLook } from './lookStore';

export function EnvironmentIBL() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const iblIntensity = useLook().iblIntensity;

  // Build the pre-filtered env map once.
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const envRT = pmrem.fromScene(room, 0.04);

    const prevEnv = scene.environment;
    scene.environment = envRT.texture;

    // RoomEnvironment's source meshes are no longer needed once pre-filtered.
    room.dispose?.();
    pmrem.dispose();

    return () => {
      scene.environment = prevEnv;
      envRT.dispose();
    };
  }, [gl, scene]);

  // Intensity is a per-frame renderer read → set it live, no rebuild.
  useEffect(() => {
    const prev = scene.environmentIntensity;
    scene.environmentIntensity = iblIntensity;
    return () => { scene.environmentIntensity = prev; };
  }, [scene, iblIntensity]);

  return null;
}
