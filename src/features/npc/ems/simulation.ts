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

/** Order nodes parents-before-children (so a node's parent world is ready). */
export function orderNodes(nodes: EMSNode[]): EMSNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: EMSNode[] = [];
  const seen = new Set<string>();
  const visit = (n: EMSNode) => {
    if (seen.has(n.id)) return;
    if (n.parent && byId.has(n.parent)) visit(byId.get(n.parent)!);
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
      // Damped spring back toward rest (disp -> 0).
      const k = node.spring.stiffness, c = node.spring.damping;
      sm.velX += (-k * sm.dispX - c * sm.velX) * dtc;
      sm.velY += (-k * sm.dispY - c * sm.velY) * dtc;
      sm.velZ += (-k * sm.dispZ - c * sm.velZ) * dtc;
      sm.dispX += sm.velX * dtc;
      sm.dispY += sm.velY * dtc;
      sm.dispZ += sm.velZ * dtc;
      rt.worldX = rx + sm.dispX;
      rt.worldY = ry + sm.dispY;
      rt.worldZ = rz + sm.dispZ;
    } else {
      rt.worldX = rx; rt.worldY = ry; rt.worldZ = rz;
    }

    rt.prevRestX = rx; rt.prevRestY = ry; rt.prevRestZ = rz;
  }
}
