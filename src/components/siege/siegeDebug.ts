// Live debug readout for the Siege Worlds world. Written by the siege hot paths
// (FortressControls physics, MonsterEnemy) as a plain mutable object — no React, so
// writes every frame are free. SiegeDebugOverlay polls + renders it. This is our
// window into why siege behaviors do/don't fire (God Mode, terrain-walk, colliders).
export const sdbg = {
  isSiege: false,
  godMode: false,
  ghf: false,            // groundHeightFn wired → terrain-walk active this frame
  onGround: false,
  playerX: 0,
  playerY: 0,
  playerZ: 0,
  fwdX: 0, fwdY: 0, fwdZ: 0,        // camera look direction (unit vector)
  yawDeg: 0, pitchDeg: 0,           // look direction as degrees (yaw 0=+Z)
  terrainY: null as number | null,  // sampleHeight at the player (null = off-map/not-loaded)
  monsters: 0,           // live MonsterEnemy count
  gridColliders: 0,      // colliders currently in worldCollisionGrid
  // ── Cave-crawl diagnostics (nearest cave-crawl monster; TEMP while debugging the garage block) ──
  cc_map: '',            // active map id (city-demo = the registered-mesh SciFi City)
  cc_mesh: false,        // meshCollidersEnabled() this frame (the system that should block them)
  cc_on: false,          // the cave-crawl mesh block's gate passed this frame
  cc_hit: false,         // resolvePlayerMeshCollision reported a wall to push out of
  cc_push: 0,            // push magnitude applied (m)
  cc_mode: '',           // its cave state machine mode (none/enter/crawl/wedged)
  cc_feetY: 0,           // its feet Y (should sit on the street, not far below/above)
};
