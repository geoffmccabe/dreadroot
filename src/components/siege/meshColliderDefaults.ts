// Models that are TRUE MESH colliders by default — no manual M-flagging needed.
// These are the big combined "blob" meshes (towns) + the large mushroom trees,
// whose old oversized single-box colliders are what made monsters "climb on air"
// and the player bump invisible walls. With these as mesh colliders, the player
// and monsters collide with the real surface instead.
//
// (The M tool still works for anything else; an explicit override also still wins
//  where it makes sense. To add an area, just add its fbx name here.)
export const DEFAULT_MESH_MODELS = new Set<string>([
  // Towns (combined blobs)
  'BeachTown',
  'ShantyTown',
  'JungleHuts',
  // Bleakrock / Mushrooms island — the big walk-on mushroom trees
  'mushroomtree05',
  'mushroomtree06',
]);
