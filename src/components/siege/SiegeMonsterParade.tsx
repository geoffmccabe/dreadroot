// SiegeMonsterParade — one of each FantasyRivals monster, converted+animated from
// the Synty source pack (idle/walk/attack), lined up near the beach so you can
// walk the row and see which animate cleanly. They have aggro, so they chase.
//
// modelHeight = the converter's measured intrinsic height (per /tmp manifest);
// height = the desired in-world height (sets relative sizing: giants tall, etc.).
import { Suspense } from 'react';
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
  ['demonmale',      2.145, 2.6, 1.8],
  ['gravedigger',    1.797, 2.0, 2],
  ['hunterm',        1.791, 1.9, 2],
  ['hunterf',        1.792, 1.85, 2],
  ['plaguedoctor',   1.791, 2.0, 2],
  ['priest',         1.792, 1.95, 2],
  ['witch',          1.792, 1.85, 2],
];

// A clear row on the beach (known-good ground ≈ 26), north of the existing monsters.
const CENTER_X = -400, ROW_Z = 758, BASE_Y = 26, SPACING = 5;

export function SiegeMonsterParade() {
  const n = PARADE.length;
  return (
    <Suspense fallback={null}>
      {PARADE.map(([name, modelHeight, height, animSpeed, speed], i) => (
        <MonsterEnemy
          key={name}
          spawn={[CENTER_X + (i - (n - 1) / 2) * SPACING, BASE_Y, ROW_Z]}
          url={`/siege/monsters/${name}.glb`}
          modelHeight={modelHeight}
          height={height}
          animSpeed={animSpeed}
          speed={speed}
          aggro={70}
          health={300}
        />
      ))}
    </Suspense>
  );
}
