/**
 * EMSRenderer — draws every active new-system NPC from its EMS skeleton. Each
 * instance renders one mesh per primitive node; a per-frame pass advances the
 * spring simulation and writes each node's world transform. Mounted inside the
 * R3F canvas (FortressScene). Reads the shared NpcManager — no props.
 *
 * v1 is declarative meshes (clear + modular); instancing is a later perf pass.
 * Locomotion here is a simple idle hop/walk bob so the spring wobble is visible;
 * real AI-driven movement is a later phase (the bob feeds the springs the same).
 */
import { useRef, useSyncExternalStore, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { npcManager, type NpcInstance } from '../NpcManager';
import { stepEMS } from './simulation';
import type { PrimitiveShape } from './types';

function geometryFor(shape: PrimitiveShape): ReactElement {
  switch (shape) {
    case 'box': return <boxGeometry args={[1, 1, 1]} />;
    case 'sphere': return <sphereGeometry args={[0.5, 16, 12]} />;
    case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 14]} />;
    case 'cone': return <coneGeometry args={[0.5, 1, 14]} />;
    case 'capsule': return <capsuleGeometry args={[0.35, 0.4, 4, 10]} />;
  }
}

function EMSInstanceView({ instance }: { instance: NpcInstance }): ReactElement {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((_, delta) => {
    const inst = instance;
    if (!inst.isActive) return;
    inst.phase += delta;

    // Idle locomotion bob (drives the springs). Hop bounces; walk gently sways.
    const bob = inst.def.locomotion === 'hop'
      ? Math.abs(Math.sin(inst.phase * 3)) * 0.45
      : Math.sin(inst.phase * 2) * 0.06;

    stepEMS(
      inst.def, inst.ordered, inst.runtimes,
      inst.position.x, inst.position.y + bob, inst.position.z, inst.yaw,
      delta,
    );

    for (let i = 0; i < inst.ordered.length; i++) {
      const rt = inst.runtimes.get(inst.ordered[i].id);
      const mesh = meshRefs.current[i];
      if (!rt || !mesh) continue;
      mesh.position.set(rt.worldX, rt.worldY, rt.worldZ);
      mesh.rotation.y = inst.yaw;
    }
  });

  return (
    <group>
      {instance.ordered.map((node, i) => (
        <mesh
          key={node.id}
          ref={(m) => { meshRefs.current[i] = m; }}
          scale={[node.size[0], node.size[1], node.size[2]]}
        >
          {geometryFor(node.shape)}
          <meshStandardMaterial color={node.color} roughness={0.6} metalness={0.15} />
        </mesh>
      ))}
    </group>
  );
}

export function EMSRenderer(): ReactElement {
  // Re-render when instances are spawned/despawned.
  useSyncExternalStore(npcManager.subscribe, npcManager.getVersion);
  const instances = npcManager.getInstances();
  return (
    <group>
      {instances.filter((i) => i.isActive).map((inst) => (
        <EMSInstanceView key={inst.id} instance={inst} />
      ))}
    </group>
  );
}
