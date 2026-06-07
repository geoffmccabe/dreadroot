// Pure mass model for enemies/physics. Mass = total volume of an entity's
// box parts (all parts assumed the same density). Used by the shared enemy
// spatial index so any enemy type participates in mass-based physics
// (knockback, future stacking) without type-specific code.
//
// Pure data + math only (no THREE / React) so it lifts to the L2 Durable
// Object unchanged, where the server resolves authoritative physics.

export interface BoxPart {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

/**
 * Sum of box volumes (width×height×depth) for one entity, scaled by the
 * instance's overall scale³. Same density → mass is proportional to volume.
 * A new enemy type just passes its parts; no hardcoding anywhere downstream.
 */
export function massFromBoxVolumes(parts: ReadonlyArray<BoxPart>, scale = 1): number {
  let volume = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    volume += p.scaleX * p.scaleY * p.scaleZ;
  }
  return volume * scale * scale * scale;
}
