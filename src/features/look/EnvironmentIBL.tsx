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
import { LOOK } from './lookConfig';

export function EnvironmentIBL() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const envRT = pmrem.fromScene(room, 0.04);

    const prevEnv = scene.environment;
    const prevIntensity = scene.environmentIntensity;
    scene.environment = envRT.texture;
    scene.environmentIntensity = LOOK.ibl.intensity;

    // RoomEnvironment's source meshes are no longer needed once pre-filtered.
    room.dispose?.();
    pmrem.dispose();

    return () => {
      scene.environment = prevEnv;
      scene.environmentIntensity = prevIntensity;
      envRT.dispose();
    };
  }, [gl, scene]);

  return null;
}
