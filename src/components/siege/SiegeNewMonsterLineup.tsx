// SiegeNewMonsterLineup — a review row of the freshly-imported Synty monsters (Goblin War Camp +
// Boss Zombies) near the Bleakrock spawn, each idling with a floating name tag, so we can walk the
// line and see which converted cleanly. Uses MonsterEnemy (the proven in-game renderer) with
// aggro=0 + wanderRadius=0 so they stand still and idle.
//
// NOTE: goblins are on the Synty humanoid rig (same as our working monsters) so they animate with
// the idle clip. The 4 boss zombies are on the Unreal rig — the idle may not bind (they may stand
// in a static T-pose) until their animations are retargeted; included here for visual review.
import { Suspense, useMemo } from 'react';
import { Billboard, Text } from '@react-three/drei';
import { MonsterEnemy } from './MonsterEnemy';
import { sampleHeight } from './terrainHeight';
import { SIEGE_SPAWN_POINT } from './siegeAreas';

// [glb name, display name, intrinsic modelHeight (from converter manifest)]
const ROW: [string, string, number][] = [
  ['goblinarcherf', 'Goblin Archer F', 1.792],
  ['goblinarcherm', 'Goblin Archer M', 1.791],
  ['goblinbeasttamer', 'Goblin Beast Tamer', 1.799],
  ['goblincook', 'Goblin Cook', 1.798],
  ['goblinking', 'Goblin King', 1.791],
  ['goblinknight', 'Goblin Knight', 1.795],
  ['goblinprisoner1', 'Goblin Prisoner 1', 1.797],
  ['goblinprisoner2', 'Goblin Prisoner 2', 1.791],
  ['goblinprisoner3', 'Goblin Prisoner 3', 1.791],
  ['goblinranger', 'Goblin Ranger', 1.797],
  ['goblinshaman', 'Goblin Shaman', 1.803],
  ['goblinwarrior', 'Goblin Warrior', 1.804],
  ['goblinwizard', 'Goblin Wizard', 1.793],
  ['goblinking2', 'Goblin King 2', 1.824],
  ['goblintroll', 'Goblin Troll', 1.825],
  ['zombieblobber', 'Zombie Blobber', 1.831],
  ['zombiebrute', 'Zombie Brute', 1.845],
  ['zombieslobber', 'Zombie Slobber', 1.831],
  ['zombiewretch', 'Zombie Wretch', 1.782],
];

const SPACING = 2.2;   // metres between monsters
const PER_ROW = 5;     // compact grid so all fit in view (not a 47 m-wide row)

export function SiegeNewMonsterLineup() {
  // A compact grid right in front of spawn, next to the Shi Yang/Thorn pair (which is at +4).
  const cx = SIEGE_SPAWN_POINT[0];
  const cz0 = SIEGE_SPAWN_POINT[2] + 6;
  const placed = useMemo(() => ROW.map(([id, name, mh], i) => {
    const col = i % PER_ROW, row = Math.floor(i / PER_ROW);
    const x = cx + (col - (PER_ROW - 1) / 2) * SPACING;
    const z = cz0 + row * SPACING;
    const y = sampleHeight(x, z) ?? SIEGE_SPAWN_POINT[1];
    return { id, name, mh, x, y, z };
  }), [cx, cz0]);

  return (
    <Suspense fallback={null}>
      {placed.map(({ id, name, mh, x, y, z }) => (
        <group key={id}>
          <MonsterEnemy
            spawn={[x, y, z]}
            url={`/siege/monsters/${id}.glb`}
            modelHeight={mh}
            height={mh}        /* natural size for review (scale 1) */
            aggro={0}
            wanderRadius={0}
            health={300}
          />
          <Billboard position={[x, y + mh + 0.6, z]}>
            <Text fontSize={0.3} color="#ffffff" anchorX="center" outlineWidth={0.03} outlineColor="#000000">
              {name}
            </Text>
          </Billboard>
        </group>
      ))}
    </Suspense>
  );
}
