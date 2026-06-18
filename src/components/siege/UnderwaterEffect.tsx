// UnderwaterEffect — what the player sees + suffers below the water surface.
//   • A murky blue-green scrim pinned to the camera that thickens with depth, so the water reads
//     as opaque from the inside (you can't see clearly out, matching the Unity look).
//   • Breath + drowning: you can stay under for BREATH_SEC, then take DROWN_DPS damage until you
//     surface. Damage routes through the shared siege player-damage sink (so Godmode ignores it).
// Self-contained: it only draws its own camera-facing scrim and reads the camera height.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { dealPlayerDamage } from './spray/sprayAttackSystem';

const BREATH_SEC = 12;   // seconds of held breath before drowning starts
const DROWN_DPS = 4;     // HP/second once breath runs out

export function UnderwaterEffect({ level }: { level: number }) {
  const camera = useThree((s) => s.camera);
  const breath = useRef(0);
  const dmgAcc = useRef(0);
  const _dir = useMemo(() => new THREE.Vector3(), []);

  const scrim = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x10384a, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    m.renderOrder = 996;
    m.frustumCulled = false;
    return m;
  }, []);

  useFrame((_, dt) => {
    const depth = level - camera.position.y;            // >0 = submerged (metres under the surface)
    const under = depth > 0.25;                         // eye clearly below the surface
    const mat = scrim.material as THREE.MeshBasicMaterial;
    // Ramp from ZERO at the surface (no sudden murk when you dip a toe / fight at the waterline).
    mat.opacity = Math.max(0, Math.min(0.85, depth * 0.12));
    camera.getWorldDirection(_dir);                     // keep the scrim in front of the camera
    scrim.position.copy(camera.position).addScaledVector(_dir, 0.55);
    scrim.quaternion.copy(camera.quaternion);

    if (under) {
      breath.current += dt;
      if (breath.current > BREATH_SEC) {
        dmgAcc.current += DROWN_DPS * dt;
        if (dmgAcc.current >= 1) {
          const d = Math.floor(dmgAcc.current); dmgAcc.current -= d;
          dealPlayerDamage(d, 0, 1, 0, 0);              // drowning: HP only, no knockback (Godmode-gated)
        }
      }
    } else {
      breath.current = Math.max(0, breath.current - dt * 4);   // refill breath fast once you surface
      dmgAcc.current = 0;
    }
  });

  return <primitive object={scrim} />;
}
