// SiegeMonsterParade — one of each FantasyRivals monster, converted+animated from
// the Synty source pack (idle/walk/attack), lined up near the beach so you can
// walk the row and see which animate cleanly. They have aggro, so they chase.
//
// modelHeight = the converter's measured intrinsic height (per /tmp manifest);
// height = the desired in-world height (sets relative sizing: giants tall, etc.).
import { Suspense } from 'react';
import { Billboard, Text } from '@react-three/drei';
import { MonsterEnemy } from './MonsterEnemy';

// name (glb under /siege/monsters/) | intrinsic modelHeight | world height | animSpeed? | moveSpeed?
// THE WORKING ROSTER: Dark Fantasy meshes + the zombie animation set, all on the
// same 50-bone rig (~1deg rest, all body bones match) as the proven dfskeleton.
// animSpeed bumps the slow zombie shamble to a normal pace. (The FantasyRivals
// monsters — giant/ork/golems — are a different rig with NO matching anim set, so
// they need Mixamo/Auto-Rig Pro; the A-pose demon/gargoyle likewise. Dropped here.)
const PARADE: [string, number, number, number?, number?][] = [
  ['zombie',         1.863, 2.0, 1.5],
  ['dfskeleton',     1.795, 6.0, 3, 5],   // GIANT skeleton: 3x height, 3x anim, faster stride
  ['skeletonflesh',  1.803, 2.0, 2],
  ['skeletonheavy',  1.795, 2.2, 2],
  ['skeletonlight',  1.795, 2.0, 2],
  ['skeletonranger', 1.797, 2.0, 2],
  ['darklord',       1.843, 2.4, 1.8],
  ['demonmale',      2.145, 3.0, 1.8],
  // removed for now (animations don't read right): gravedigger, hunterm/f, plaguedoctor, priest, witch
];

// ROW 2 — previously dropped as "animations don't read right", but the Challenge Creator preview
// proved they animate cleanly, and the in-game idle clip now falls back to the first clip (so the
// oddly-named Synty/Mixamo idle tracks resolve). modelHeight = measured intrinsic glb height; height
// = desired in-world height. Re-added so we can walk the row and confirm each animates in the world.
const PARADE2: [string, number, number, number?, number?][] = [
  ['gravedigger',     1.800, 2.1],
  ['hunterm',         1.791, 2.1],
  ['hunterf',         1.910, 2.0],
  ['plaguedoctor',    1.791, 2.1],
  ['priest',          1.792, 2.1],
  ['darkelf',         1.831, 2.0],
  ['medusa',          1.872, 2.2],
  ['mystic',          1.859, 2.1],
  ['evilgod',         1.898, 2.6],
  ['ancientqueen',    1.984, 2.2],
  ['ancientwarrior',  2.093, 2.2],
  ['forestwitch',     1.906, 2.1],
  ['dfdemon',         1.909, 2.4],
  ['dfgargoyle',      1.904, 2.4],
  ['pigbutcher',      1.822, 2.4],
  ['mutant',          1.952, 2.6],
  ['bigork',          1.861, 2.8],
  ['dwarf',           1.986, 1.6],
  ['forestguardian',  2.194, 3.2],
  ['barbariangiant',  1.834, 3.4],
  ['elementalgolem',  1.824, 3.0],
  ['mechanicalgolem', 1.791, 3.0],
  ['fortgolem',       1.883, 3.2],
];

// A clear row on the beach (known-good ground ≈ 26), north of the existing monsters.
const CENTER_X = -400, ROW_Z = 758, BASE_Y = 26, SPACING = 5;
const ROW2_Z = 770;   // a second row just behind the first

function ParadeRow({ list, rowZ }: { list: [string, number, number, number?, number?][]; rowZ: number }) {
  const n = list.length;
  return (
    <>
      {list.map(([name, modelHeight, height, animSpeed, speed], i) => {
        const x = CENTER_X + (i - (n - 1) / 2) * SPACING;
        return (
          <group key={name}>
            {/* aggro 0 + wander 0 = they stand still and idle, so the name tag above
                each one stays correct (no chasing off and leaving the label behind). */}
            <MonsterEnemy
              spawn={[x, BASE_Y, rowZ]}
              url={`/siege/monsters/${name}.glb`}
              modelHeight={modelHeight}
              height={height}
              animSpeed={animSpeed}
              speed={speed}
              aggro={0}
              wanderRadius={0}
              health={300}
            />
            {/* Floating name tag so you can tell me which one looks good. */}
            <Billboard position={[x, BASE_Y + height + 1.2, rowZ]}>
              <Text fontSize={0.7} color="#ffffff" anchorX="center" outlineWidth={0.06} outlineColor="#000000">
                {name}
              </Text>
            </Billboard>
          </group>
        );
      })}
    </>
  );
}

export function SiegeMonsterParade() {
  return (
    <Suspense fallback={null}>
      <ParadeRow list={PARADE} rowZ={ROW_Z} />
      <ParadeRow list={PARADE2} rowZ={ROW2_Z} />
    </Suspense>
  );
}
