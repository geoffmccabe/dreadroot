// The mushroom-TREE models (public/siege/imports) available to the Model Placer + the Procedural
// Generator. Khaured Tower is intentionally excluded (it's a structure, not a tree). One list, so the
// manual palette and the PG stay in sync as we add species.
// Alphabetized. The 10 "Ashley_N" are Ashley's mushrooms: Ashley_1/2 = the vine trees (were
// mushroomtree05/06), Ashley_3–10 = the 8 split from the ashley_tree05 demo sheet.
export const MUSHROOM_TREES: string[] = [
  'Ashley_1', 'Ashley_2', 'Ashley_3', 'Ashley_4', 'Ashley_5',
  'Ashley_6', 'Ashley_7', 'Ashley_8', 'Ashley_9', 'Ashley_10',
  'jhay_tree1', 'jhay_tree2', 'jhay_tree3', 'jhay_tree4', 'jhay_tree5', 'jhay_tree6',
  'meshes_tree05_tall', 'meshes_tree06_tall',
  'mushroom_line_straight',
  'mushrooms2_tree06_1', 'mushrooms2_tree06_2', 'mushrooms2_tree06_3',
  'mushroomtree07_1', 'mushroomtree07_2',
  'MushroomTree_A',
  'Tree1',
  'vasim_tree1_collider', 'vasim_tree1_collider2', 'vasim_tree1_collider_feb25', 'vasim_tree1_flat',
];
export const importUrl = (file: string) => `/siege/imports/${file}.glb`;
