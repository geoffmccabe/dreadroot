// Fortress build permissions (SCAFFOLD — NOT YET ENFORCED).
//
// Design: only a fortress's OWNER and their assigned TRIBE may build inside that fortress's
// zone (footprint + protective ring); every other player is blocked. The tribe roster will
// come from a future Tribe UI/system (e.g. a `fortress_tribe` table: owner_id → allowed
// user_ids).
//
// Until that ships this module is intentionally left "hanging": isTribeMember() is a stub
// (owner-only) and nothing in the live block-placement pipeline calls canBuildAt() yet.
//
// TODO(tribe): when the Tribe feature lands —
//   1) populate membership from the Tribe table (replace the stub below), and
//   2) call canBuildAt() from the shared block-placement write path so non-members are
//      denied inside a fortress zone (coordinate with the L1/L2 write-surface work).

export interface FortressZone {
  ownerId: string;
  minX: number; maxX: number;
  minZ: number; maxZ: number;
}

/** STUB: real membership comes from the future Tribe roster. For now, only the owner counts. */
export async function isTribeMember(_ownerId: string, _userId: string): Promise<boolean> {
  return false; // TODO(tribe): look up the owner's tribe roster
}

/** Whether `userId` may build at (x,z): allowed outside every fortress zone, inside their own,
 *  or inside a zone whose owner has them in their tribe. Otherwise denied.
 *  NOT wired into the placement pipeline yet — see the file header. */
export async function canBuildAt(userId: string, x: number, z: number, zones: FortressZone[]): Promise<boolean> {
  for (const zone of zones) {
    if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) continue; // outside this zone
    if (zone.ownerId === userId) continue;                       // own fortress
    if (await isTribeMember(zone.ownerId, userId)) continue;      // assigned tribe member
    return false;                                                // inside someone else's fortress zone
  }
  return true;
}
