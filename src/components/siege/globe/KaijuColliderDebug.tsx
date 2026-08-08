// KaijuColliderDebug — draw the bullet colliders, because I have now been wrong about them
// four times and reasoning is clearly not working.
//
// Geoff, repeatedly: "the bullets are still hitting an invisible wall of colliders." Each time I
// have found a real bug, fixed it, and been wrong that it was THE bug. Every one of those rounds
// cost a deploy and a test, and the reason is that neither of us can see the shape being tested
// against — so a collider 40 m too wide and a collider in completely the wrong place look identical
// from outside, and they need opposite fixes.
//
// Press O. Every capsule a bullet can hit is outlined in the world: the torso in green, the arms and
// legs and head in cyan, and the SEPARATION capsule in dim red so the two are never confused again
// (that one is deliberately enormous and is not a bullet target).
//
// This is a debug overlay, off by default, and it costs nothing when off.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ARENA_HEIGHT, getAgents } from './kaijuArena';
import {
  limbCapsules, torsoCapsule, bulletTorsoFrac, torsoRadiusFrac, type Capsule,
} from './kaijuColliders';
import { playerVisual } from './kaijuGunfire';
import { hasHitMesh } from './kaijuMeshHit';

let on = false;
const listeners = new Set<() => void>();
export function toggleColliderDebug(): void {
  on = !on;
  for (const l of listeners) l();
  console.log(`[kaiju] collider outlines ${on ? 'ON' : 'OFF'}`);
}
export function isColliderDebugOn(): boolean { return on; }

/** Rings around the axis plus rails along it — enough to read a capsule's size and where it ends. */
const RINGS = 5;
const RADIALS = 12;
/** Vertices per capsule: RINGS closed circles, plus RADIALS rails from end to end. */
const VERTS_PER_CAPSULE = RINGS * RADIALS * 2 + RADIALS * 2;
const MAX_CAPSULES = 64;

export function KaijuColliderDebug() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  if (!on) return null;
  return <Outlines />;
}

function Outlines() {
  const lines = useRef<THREE.LineSegments>(null);
  const buf = useMemo(() => ({
    pos: new Float32Array(MAX_CAPSULES * VERTS_PER_CAPSULE * 3),
    col: new Float32Array(MAX_CAPSULES * VERTS_PER_CAPSULE * 3),
  }), []);
  const v = useMemo(() => ({
    axis: new THREE.Vector3(), u: new THREE.Vector3(), w: new THREE.Vector3(),
    p: new THREE.Vector3(), q: new THREE.Vector3(),
    cap: { a: new THREE.Vector3(), b: new THREE.Vector3(), radius: 0, part: 'torso' } as Capsule,
  }), []);

  useFrame(() => {
    const L = lines.current;
    if (!L) return;
    let n = 0;                                  // vertex count
    const put = (x: number, y: number, z: number, r: number, g: number, b: number) => {
      const o = n * 3;
      buf.pos[o] = x; buf.pos[o + 1] = y; buf.pos[o + 2] = z;
      buf.col[o] = r; buf.col[o + 1] = g; buf.col[o + 2] = b;
      n++;
    };

    const draw = (c: Capsule, r: number, g: number, b: number) => {
      if (n + VERTS_PER_CAPSULE > MAX_CAPSULES * VERTS_PER_CAPSULE) return;
      v.axis.copy(c.b).sub(c.a);
      const len = v.axis.length();
      if (len < 1e-9) return;
      v.axis.divideScalar(len);
      // Any two vectors perpendicular to the axis. Picking the smaller-component seed avoids the
      // degenerate case where the axis happens to be parallel to whatever was chosen.
      v.u.set(1, 0, 0);
      if (Math.abs(v.axis.x) > 0.9) v.u.set(0, 1, 0);
      v.u.crossVectors(v.axis, v.u).normalize();
      v.w.crossVectors(v.axis, v.u).normalize();

      for (let ring = 0; ring < RINGS; ring++) {
        const t = ring / (RINGS - 1);
        v.p.copy(c.a).addScaledVector(v.axis, len * t);
        for (let i = 0; i < RADIALS; i++) {
          const a0 = (i / RADIALS) * Math.PI * 2;
          const a1 = ((i + 1) / RADIALS) * Math.PI * 2;
          v.q.copy(v.p).addScaledVector(v.u, Math.cos(a0) * c.radius).addScaledVector(v.w, Math.sin(a0) * c.radius);
          put(v.q.x, v.q.y, v.q.z, r, g, b);
          v.q.copy(v.p).addScaledVector(v.u, Math.cos(a1) * c.radius).addScaledVector(v.w, Math.sin(a1) * c.radius);
          put(v.q.x, v.q.y, v.q.z, r, g, b);
        }
      }
      for (let i = 0; i < RADIALS; i++) {
        const a = (i / RADIALS) * Math.PI * 2;
        v.q.copy(c.a).addScaledVector(v.u, Math.cos(a) * c.radius).addScaledVector(v.w, Math.sin(a) * c.radius);
        put(v.q.x, v.q.y, v.q.z, r, g, b);
        v.q.copy(c.b).addScaledVector(v.u, Math.cos(a) * c.radius).addScaledVector(v.w, Math.sin(a) * c.radius);
        put(v.q.x, v.q.y, v.q.z, r, g, b);
      }
    };

    for (const a of getAgents()) {
      if (!a.alive) continue;
      const lab = a.isPlayer && playerVisual.type >= 0 ? playerVisual : null;
      const height = lab ? lab.height : ARENA_HEIGHT;
      const type = lab ? lab.type : a.monsterType;
      // The SEPARATION capsule, dim red. Enormous on purpose and NOT a bullet target — drawing it
      // is the whole point, because mistaking it for the hit shape is the error I kept making.
      draw(torsoCapsule(a.body.dir, a.body.radius, height, v.cap, torsoRadiusFrac), 0.35, 0.05, 0.05);
      // THE BULLET SHAPE. Once a model has loaded this is the MESH ITSELF — real triangles, in the
      // pose being drawn — so there is nothing to outline and drawing a cylinder here would be a
      // lie about what is being tested. Capsules appear only while a model is still loading, or
      // headless, which is exactly when they are the shape in use.
      if (!hasHitMesh(a.id)) {
        draw(torsoCapsule(a.body.dir, a.body.radius, height, v.cap, bulletTorsoFrac(type)), 0.1, 1, 0.2);
        for (const c of limbCapsules(a.id)) draw(c, 0.1, 0.9, 1);
      }
    }

    L.geometry.setDrawRange(0, n);
    L.geometry.attributes.position.needsUpdate = true;
    L.geometry.attributes.color.needsUpdate = true;
  });

  return (
    <lineSegments ref={lines} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buf.pos, 3]} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-color" args={[buf.col, 3]} usage={THREE.DynamicDrawUsage} />
      </bufferGeometry>
      {/* Depth test off: the point is to see where the shape is relative to the mesh, and a
          collider hidden inside the model it is meant to match tells you nothing. */}
      <lineBasicMaterial vertexColors transparent opacity={0.9} depthTest={false} toneMapped={false} />
    </lineSegments>
  );
}
