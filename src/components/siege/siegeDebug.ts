// Live debug readout for the Siege Worlds world. Written by the siege hot paths
// (FortressControls physics, MonsterEnemy) as a plain mutable object — no React, so
// writes every frame are free. SiegeDebugOverlay polls + renders it. This is our
// window into why siege behaviors do/don't fire (God Mode, terrain-walk, colliders).
export const sdbg = {
  isSiege: false,
  godMode: false,
  ghf: false,            // groundHeightFn wired → terrain-walk active this frame
  onGround: false,
  playerY: 0,
  terrainY: null as number | null,  // sampleHeight at the player (null = off-map/not-loaded)
  monsters: 0,           // live MonsterEnemy count
  gridColliders: 0,      // colliders currently in worldCollisionGrid
};
