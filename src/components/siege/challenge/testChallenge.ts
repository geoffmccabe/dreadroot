// A hardcoded 10-wave challenge for testing the runner (Phase 1). Per Geoff's spec:
// waves 1-7 = one of each monster type 1..7; wave 8 = a #1 horde of 20; wave 9 = a #2 horde of 50;
// wave 10 = one of each (1-7) PLUS a #1 horde of 20 and a #2 horde of 50. 1 minute each.
import type { Challenge } from './challengeTypes';

// Bleakrock (mushroom island) centroid — challenge runs here for now.
const CX = -1039, CZ = 1108;

export const TEST_CHALLENGE: Challenge = {
  name: 'Test Gauntlet',
  creator: 'system',
  spawn: [-1039, 24, 1108],    // teleport the player to Bleakrock on start
  waves: [
    { name: 'Red Demons',      timeSec: 60, drops: [{ type: 1, count: 10, x: CX, z: CZ }] },
    { name: 'Mushroom Grunts',  timeSec: 60, drops: [{ type: 2, count: 10, x: CX, z: CZ }] },
    { name: 'Giant Skeleton',  timeSec: 60, text: 'Aim high.', drops: [{ type: 3, count: 1, x: CX, z: CZ }] },
    { name: 'Vomit Demon',     timeSec: 60, text: 'Keep moving — it spits.', drops: [{ type: 4, count: 1, x: CX, z: CZ }] },
    { name: 'Dark Lord',       timeSec: 60, text: 'It teleports behind you.', drops: [{ type: 5, count: 1, x: CX, z: CZ }] },
    { name: 'Bloody Horde',    timeSec: 60, drops: [{ type: 6, count: 1, x: CX, z: CZ }] },
    { name: 'Spintroll',       timeSec: 60, text: "Don't get caught in its zoom.", drops: [{ type: 7, count: 1, x: CX, z: CZ }] },
    { name: 'Demon Swarm',     timeSec: 60, drops: [{ type: 1, count: 20, x: CX, z: CZ }] },
    { name: 'Skeleton Tide',   timeSec: 60, drops: [{ type: 2, count: 50, x: CX, z: CZ }] },
    {
      name: 'Everything', timeSec: 60, text: 'Survive it all.',
      drops: [
        { type: 1, count: 1, x: CX - 15, z: CZ },
        { type: 2, count: 1, x: CX - 10, z: CZ },
        { type: 3, count: 1, x: CX - 5,  z: CZ },
        { type: 4, count: 1, x: CX,      z: CZ },
        { type: 5, count: 1, x: CX + 5,  z: CZ },
        { type: 6, count: 1, x: CX + 10, z: CZ },
        { type: 7, count: 1, x: CX + 15, z: CZ },
        { type: 1, count: 20, x: CX - 12, z: CZ + 12 },
        { type: 2, count: 50, x: CX + 12, z: CZ + 12 },
      ],
    },
  ],
};
