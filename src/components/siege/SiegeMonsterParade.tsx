// SiegeMonsterParade — one of each FantasyRivals monster, converted+animated from
// the Synty source pack (idle/walk/attack), lined up near the beach so you can
// walk the row and see which animate cleanly. They have aggro, so they chase.
//
// modelHeight = the converter's measured intrinsic height (per /tmp manifest);
// height = the desired in-world height (sets relative sizing: giants tall, etc.).
import { Suspense } from 'react';
import { MonsterEnemy } from './MonsterEnemy';

// name (glb under /siege/monsters/) | intrinsic modelHeight | desired world height
const PARADE: [string, number, number][] = [
  ['barbariangiant', 1.834, 5.0],
  ['bigork',         1.861, 3.0],
  ['trollbase',      1.818, 2.8],
  ['fortgolem',      1.883, 6.0],
  ['mechanicalgolem',1.791, 3.5],
  ['elementalgolem', 1.824, 8.0],
  ['mutant',         1.952, 2.8],
  ['pigbutcher',     1.822, 2.4],
  ['forestguardian', 2.194, 3.0],
  ['slayer',         1.853, 2.2],
  ['evilgod',        1.898, 1.8],
  ['spiritdemon',    1.941, 2.1],
  ['medusa',         1.872, 1.8],
  ['ancientwarrior', 2.093, 1.8],
  ['ancientqueen',   1.984, 1.8],
  ['mystic',         1.859, 1.8],
  ['darkelf',        1.831, 1.8],
  ['forestwitch',    1.906, 1.8],
  ['dwarf',          1.986, 1.5],
];

// A clear row on the beach (known-good ground ≈ 26), north of the existing monsters.
const CENTER_X = -400, ROW_Z = 758, BASE_Y = 26, SPACING = 5;

export function SiegeMonsterParade() {
  const n = PARADE.length;
  return (
    <Suspense fallback={null}>
      {PARADE.map(([name, modelHeight, height], i) => (
        <MonsterEnemy
          key={name}
          spawn={[CENTER_X + (i - (n - 1) / 2) * SPACING, BASE_Y, ROW_Z]}
          url={`/siege/monsters/${name}.glb`}
          modelHeight={modelHeight}
          height={height}
          aggro={70}
          health={300}
        />
      ))}
    </Suspense>
  );
}
