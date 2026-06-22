// chestDrops — the Magic Chest prize chart + reel generation, ported from the SW server
// (PrizeChest.java). The key is item 152 (consumed on open). A 40-item reel is generated; index
// 39 is the ACTUAL prize, with rares salted through the strip for tease. The reel UI scrolls to
// land on index 39.
//
// NOTE: this runs client-side for now (consume key + grant prize via the inventory API). Like the
// grant_* RPCs, it should move to a server-validated RPC before launch (anti-cheat).

export const CHEST_KEY_ITEM_ID = 152;

export const BASIC_PRIZE_IDS = [0, 1, 2, 3, 4, 5, 6, 8, 12, 15, 17, 18, 19, 20, 21, 22, 23, 153];
export const RARE_PRIZE_IDS = [142, 81, 14, 63, 143, 180];
export const RARE_CHANCE = 90;   // ~1-in-90 that the final prize is from the rare table
export const REEL_LEN = 40;
export const PRIZE_INDEX = REEL_LEN - 1;   // 39 — where the reel lands

const rand = (n: number) => Math.floor(Math.random() * n);
const basic = () => BASIC_PRIZE_IDS[rand(BASIC_PRIZE_IDS.length)];
const rare = () => RARE_PRIZE_IDS[rand(RARE_PRIZE_IDS.length)];

/** 40-item reel; [39] = the real prize (90% basic / ~1% rare), [38] = teaser, 0..37 = filler. */
export function generatePrizeList(): number[] {
  const reel = new Array<number>(REEL_LEN);
  reel[39] = rand(RARE_CHANCE) === 0 ? rare() : basic();
  reel[38] = rand(2) === 0 ? rare() : basic();
  for (let i = 0; i < 38; i++) reel[i] = rand(6) === 0 ? rare() : basic();
  return reel;
}

export const isRarePrize = (id: number): boolean => RARE_PRIZE_IDS.includes(id);
