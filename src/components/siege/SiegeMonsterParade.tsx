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
  ['barbariangiant', 2.889, 3.6],
  ['bigork',         1.878, 3.0],
  ['trollbase',      2.889, 3.0],
  ['fortgolem',      2.890, 3.4],
  ['mechanicalgolem',2.889, 3.4],
  ['elementalgolem', 2.893, 3.2],
  ['mutant',         3.069, 3.0],
  ['pigbutcher',     2.889, 2.8],
  ['forestguardian', 2.194, 2.8],
  ['slayer',         2.889, 2.6],
  ['evilgod',        2.038, 2.6],
  ['spiritdemon',    1.804, 2.1],
  ['medusa',         2.108, 2.5],
  ['ancientwarrior', 2.093, 2.4],
  ['ancientqueen',   2.041, 2.3],
  ['mystic',         2.048, 2.3],
  ['darkelf',        2.048, 2.2],
  ['forestwitch',    2.041, 2.2],
  ['dwarf',          2.889, 1.9],
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
