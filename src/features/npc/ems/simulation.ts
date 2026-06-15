/**
 * EMS simulation — turns a static skeleton into the signature wobble.
 *
 * Each frame, every node's REST world pose is computed from its parent's
 * (possibly already-wobbling) world pose + its yaw-rotated offset. For SPRING
 * bonds we add inertia: when the rest pose moves (the body walked/turned/hopped)
 * the node is briefly left where it was in world space (disp -= deltaRest), then
 * a damped spring (generalized from the vortax regroup integrator) pulls it back
 * to rest. Children of a spring parent inherit its wobble and add their own — so
 * a hopping body makes ear-cylinders bend and lag. RIGID bonds just track rest.
 *
 * Pure math, no THREE/React.
 */
import type { EMSDefinition, EMSNode, EMSNodeSim } from './types';

export interface NodeRuntime {
  sim: EMSNodeSim;
  prevRestX: number; prevRestY: number; prevRestZ: number;
  worldX: number; worldY: number; worldZ: number;
  inited: boolean;
}

export function createNodeRuntime(): NodeRuntime {
  return {
    sim: { dispX: 0, dispY: 0, dispZ: 0, velX: 0, velY: 0, velZ: 0 },
    prevRestX: 0, prevRestY: 0, prevRestZ: 0,
    worldX: 0, worldY: 0, worldZ: 0,
    inited: false,
  };
}

/** Order nodes parents-before-children (so a node's parent world is ready).
 *  Cycle-safe: a `visiting` set breaks any parent cycle the editor could create
 *  (A→B→A) instead of recursing forever. */
export function orderNodes(nodes: EMSNode[]): EMSNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: EMSNode[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const visit = (n: EMSNode) => {
    if (seen.has(n.id) || visiting.has(n.id)) return; // visiting → cycle, break it
    visiting.add(n.id);
    if (n.parent && byId.has(n.parent)) visit(byId.get(n.parent)!);
    visiting.delete(n.id);
    seen.add(n.id);
    out.push(n);
  };
  for (const n of nodes) visit(n);
  return out;
}

/**
 * Advance one NPC's EMS one frame, writing each node's world position into
 * `runtimes`. The caller supplies the body root pose (already bobbed by any
 * locomotion) and dt.
 */
export function stepEMS(
  def: EMSDefinition,
  ordered: EMSNode[],
  runtimes: Map<string, NodeRuntime>,
  rootX: number, rootY: number, rootZ: number, rootYaw: number,
  dt: number,
): void {
  const cos = Math.cos(rootYaw);
  const sin = Math.sin(rootYaw);
  const s = def.scale || 1;
  const dtc = Math.min(Math.max(dt, 0.0001), 0.05); // clamp for spring stability

  for (const node of ordered) {
    const rt = runtimes.get(node.id);
    if (!rt) continue;

    // Parent's final (possibly wobbling) world pose, else the body root.
    let px = rootX, py = rootY, pz = rootZ;
    if (node.parent) {
      const prt = runtimes.get(node.parent);
      if (prt) { px = prt.worldX; py = prt.worldY; pz = prt.worldZ; }
    }

    // Rest world = parent + yaw-rotated, scaled offset.
    const ox = node.offset[0] * s, oy = node.offset[1] * s, oz = node.offset[2] * s;
    const rx = px + (ox * cos + oz * sin);
    const ry = py + oy;
    const rz = pz + (-ox * sin + oz * cos);

    if (!rt.inited) {
      rt.prevRestX = rx; rt.prevRestY = ry; rt.prevRestZ = rz;
      rt.inited = true;
    }

    if (node.bond === 'spring' && node.spring) {
      const sm = rt.sim;
      // Inertia: leave the node in world space as its rest pose shifts.
      sm.dispX -= (rx - rt.prevRestX);
      sm.dispY -= (ry - rt.prevRestY);
      sm.dispZ -= (rz - rt.prevRestZ);
      // Damped spring back toward rest (disp -> 0). Clamp k/c to a stable range:
      // semi-implicit Euler is stable while dt*sqrt(k) < 2, i.e. k < (2/dt)^2 =
      // 1600 at dt=0.05 — so a wild editor value can't blow the integrator up.
      const k = Math.min(Math.max(node.spring.stiffness, 1), 1500);
      const c = Math.min(Math.max(node.spring.damping, 0), 60);
      sm.velX += (-k * sm.dispX - c * sm.velX) * dtc;
      sm.velY += (-k * sm.dispY - c * sm.velY) * dtc;
      sm.velZ += (-k * sm.dispZ - c * sm.velZ) * dtc;
      sm.dispX += sm.velX * dtc;
      sm.dispY += sm.velY * dtc;
      sm.dispZ += sm.velZ * dtc;
      // Safety net: clamp runaway / non-finite displacement so a bad config
      // can't fling a primitive to infinity.
      const MAXD = 8;
      if (!Number.isFinite(sm.dispX)) { sm.dispX = 0; sm.velX = 0; } else sm.dispX = Math.min(Math.max(sm.dispX, -MAXD), MAXD);
      if (!Number.isFinite(sm.dispY)) { sm.dispY = 0; sm.velY = 0; } else sm.dispY = Math.min(Math.max(sm.dispY, -MAXD), MAXD);
      if (!Number.isFinite(sm.dispZ)) { sm.dispZ = 0; sm.velZ = 0; } else sm.dispZ = Math.min(Math.max(sm.dispZ, -MAXD), MAXD);
      rt.worldX = rx + sm.dispX;
      rt.worldY = ry + sm.dispY;
      rt.worldZ = rz + sm.dispZ;
    } else {
      rt.worldX = rx; rt.worldY = ry; rt.worldZ = rz;
    }

    rt.prevRestX = rx; rt.prevRestY = ry; rt.prevRestZ = rz;
  }
}
