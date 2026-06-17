// BleakrockLighting — proximity-driven horror atmosphere for the Bleakrock (mushroom) island.
// Self-contained: it only ever touches scene.fog (snapshotting + restoring whatever was there
// before) and draws its own camera-facing dimming scrim, so it never fights the shared DreadRoot
// day/night lighting and leaves the rest of the world untouched. As the player nears Bleakrock
// the world sinks into a cold, close, Silent-Hill dark fog and the view dims to a sickly teal.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const CENTER = new THREE.Vector3(-1039, 24, 1108);   // Bleakrock centroid (teleport slot 3)
const RADIUS = 300;                                  // full horror within this many metres
const FADE = 160;                                    // blends in/out across this band beyond it
const FOG_COLOR = 0x0a1512;                          // near-black sickly teal

export function BleakrockLighting() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const owning = useRef(false);
  const savedFog = useRef<THREE.FogBase | null>(null);
  const horrorFog = useMemo(() => new THREE.Fog(FOG_COLOR, 12, 200), []);
  const _dir = useMemo(() => new THREE.Vector3(), []);

  // A dark, cold scrim kept just in front of the camera — dims + tints the WHOLE view (the close
  // range the distance fog can't reach), giving the night-horror feel without dimming any lights.
  const scrim = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x05100c, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    m.renderOrder = 997;
    m.frustumCulled = false;
    return m;
  }, []);

  useEffect(() => () => {                              // restore on unmount
    if (owning.current) scene.fog = savedFog.current;
  }, [scene]);

  useFrame(() => {
    const dx = camera.position.x - CENTER.x, dz = camera.position.z - CENTER.z;
    const dist = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, (RADIUS + FADE - dist) / FADE));

    // Scrim follows the camera, opacity ramps with closeness.
    (scrim.material as THREE.MeshBasicMaterial).opacity = t * 0.5;
    camera.getWorldDirection(_dir);
    scrim.position.copy(camera.position).addScaledVector(_dir, 0.6);
    scrim.quaternion.copy(camera.quaternion);

    if (t > 0.001) {
      if (!owning.current) { owning.current = true; savedFog.current = scene.fog; }
      horrorFog.near = THREE.MathUtils.lerp(900, 14, t);   // pull the fog in close as you approach
      horrorFog.far = THREE.MathUtils.lerp(4000, 135, t);
      scene.fog = horrorFog;
    } else if (owning.current) {
      owning.current = false; scene.fog = savedFog.current; // hand fog back when you leave
    }
  });

  return <primitive object={scrim} />;
}
