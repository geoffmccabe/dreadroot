// Models that are TRUE MESH colliders by default.
//
// ⚠ IMPORTANT: this is intentionally EMPTY. Mesh colliders (three-mesh-bvh) are
// currently respected ONLY by the player. BULLETS and MONSTERS use the box
// collision grid. So making a model "mesh by default" REMOVES its box colliders,
// which makes bullets and monsters pass straight through it. For the towns to
// collide for everyone, they need BOX colliders (ideally voxelized = tight boxes).
//
// Keep this empty until bullets + monsters also consult the mesh BVH. The M tool
// still lets you add a player-only mesh collider to an individual object.
export const DEFAULT_MESH_MODELS = new Set<string>([]);
