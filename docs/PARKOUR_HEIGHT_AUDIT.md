# Parkour, character height, and 1m blocks — audit

Blocks are exactly 1m. Characters are not exactly anything. This is what that
costs, measured rather than assumed.

## 1. The thresholds are absolute; the characters are not

`moves.ts` decides every move from absolute metres, identically for everyone:

    stepUpMax 0.6 · vaultLowMax 1.4 · vaultHighMax 2.4 · mantleMax 2.2 · wallRunMax 3.5

The in-game heights (`dreadrootCharacters.ts targetH`) run 1.75m (Jeanette) to
2.22m (Fluffer) — a 27% spread. So one 1m block is:

| character | height | 1m block is | reads as |
|---|---|---|---|
| Jeanette | 1.75 | 57% of her | upper chest |
| Ash, Flamma | 1.95 | 51% | waist |
| Rajax, Shi Yang | 2.10 | 48% | waist |
| Fluffer | 2.22 | 45% | upper thigh |

Every one of them currently gets the identical `vaultLow` and the identical
animation. At 1 block that is survivable. At 2 blocks it is not: a 2m wall is
**114% of Jeanette's height** and **90% of Fluffer's**. One of them is diving
over something taller than she is; the other is clearing chest height. Same
decision, same clip.

## 2. `vaultHigh` had no animation of its own

The runner distinguishes `vaultLow` from `vaultHigh`, but `useParkour` collapses
both to the single `vault` action, and that action had one clip — the 1m hop. So
a 2-block vault played the 1-block animation.

We have owned `Anim_Parkour_Run_To_Dive_Over_2m_Object_NoSkin` the whole time and
nothing referenced it. Now wired as a distinct `vaultHigh` action. **The runner
still needs a one-line change to ask for it** — that file belongs to the other
session, so it is flagged rather than edited.

Five more parkour clips are also owned and unreferenced: backslide-under-1m, two
front flips, side-jump and side-flip over 1m, and two wall-runs. `slideUnder` and
`wallRun` are moves the table can already choose, so those two are the same bug
waiting to be noticed.

## 3. Scaling the thresholds without landing on a block boundary

The tempting fix — multiply every threshold by `height / 1.8` — introduces a
worse bug. For a 1.75m character `vaultLowMax` becomes 1.36m, and for shorter
rigs it lands near 1.09m: within 9cm of a 1-block obstacle. A float comparison
that close to an exact block height will flip on measurement noise, and the
player gets a different move on identical geometry.

Because the world is voxel, that comparison never needs to happen at runtime.
Obstacle heights are integers. Resolve the ratio ONCE per character into a block
count:

    maxVaultLowBlocks = floor(0.78 × height)      // 1.4 / 1.8
    maxVaultHighBlocks = floor(1.33 × height)     // 2.4 / 1.8
    maxMantleBlocks    = floor(1.22 × height)     // 2.2 / 1.8

Same rule, but the decision becomes a table lookup on an integer, so it is
deterministic, inspectable, and cannot flicker. The divisor 1.8 is the height the
Mixamo clips were authored at, and is already `REF_HEIGHT` in the weapon code.

Resolved for the in-game heights:

| character | h | vaultLow ≤ | vaultHigh ≤ | mantle ≤ |
|---|---|---|---|---|
| Jeanette | 1.75 | 1 blk | 2 blk | 2 blk |
| Ash, Flamma | 1.95 | 1 | 2 | 2 |
| Rajax, Shi Yang | 2.10 | 1 | 2 | 2 |
| Fluffer | 2.22 | 1 | 2 | 2 |

Which is the honest answer to "does height matter here": **at the current spread
of 1.75–2.22m, it does not change a single outcome.** Every character resolves to
the same table. The absolute thresholds are, by luck, fine.

It starts to matter the moment a character falls outside roughly 1.3m–2.5m, and
the ratio form is what makes that safe. It is worth adopting for that reason, not
for a change you would see today.

## 4. The height tables disagree with each other

Two tables give different heights for the same characters:

| character | lineup `heightM` | in-game `targetH` | disagreement |
|---|---|---|---|
| Thorn | 1.40 | 1.92 | **37%** |
| Dago | 2.20 | 1.85 | 19% |
| Rajax | 1.75 | 2.10 | 20% |
| Jankz | 1.65 | 1.86 | 13% |
| Fluffer | 2.30 | 2.22 | 3% |
| Ash | 2.00 | 1.95 | 3% |

Anything height-relative must read `targetH`, which is what the player actually
is. It is also measured from the model rather than guessed, so it is the more
trustworthy of the two.

## 5. Weapon size does not transfer from the tuner to the game

Worth knowing because it affects tuning already done.

The lineup sizes a gun as `lengthM × (charHeight / 1.8) × sizeByChar`. The game
sizes it as `lengthM × sizeByChar` — **no height term at all.** So a gun tuned by
eye in the lineup renders at a different size in the game, off by exactly that
character's height factor:

| character | in-game vs lineup |
|---|---|
| Fluffer | 22% smaller |
| Dago | 18% smaller |
| Ash | 11% smaller |
| Rajax | 3% larger |
| Jankz | 9% larger |
| Thorn | 29% larger |

Both behaviours are defensible — the lineup gives taller characters
proportionally bigger guns, the game gives everyone the same real-world weapon —
but they must not disagree, or eye-tuning in the lineup is calibrating against
something the player never sees. Which way to resolve it is a design call, not a
bug fix, so nothing has been changed.
