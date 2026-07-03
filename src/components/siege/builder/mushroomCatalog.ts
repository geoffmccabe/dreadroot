// The mushroom-TREE models (public/siege/imports) available to the Model Placer + the Procedural
// Generator. Khaured Tower is intentionally excluded (it's a structure, not a tree). One list, so the
// manual palette and the PG stay in sync as we add species.
export const MUSHROOM_TREES: string[] = [
  'mushroomtree05', 'mushroomtree06',
  // mushroomtree07 was TWO trees → split into individuals
  'mushroomtree07_1', 'mushroomtree07_2',
  'MushroomTree_A', 'Tree1',
  'vasim_tree1_collider', 'vasim_tree1_collider_feb25', 'vasim_tree1_collider2', 'vasim_tree1_flat',
  'jhay_tree1', 'jhay_tree2', 'jhay_tree3', 'jhay_tree4', 'jhay_tree5', 'jhay_tree6',
  'meshes_tree05_tall', 'meshes_tree06_tall',
  // ashley_tree05 was a demo sheet of 5 different mushrooms → split
  'ashley_tree05_1', 'ashley_tree05_2', 'ashley_tree05_3', 'ashley_tree05_4', 'ashley_tree05_5',
  // mushrooms2_tree06 was 3 mushrooms → split
  'mushrooms2_tree06_1', 'mushrooms2_tree06_2', 'mushrooms2_tree06_3',
  'mushroom_line_straight',
];
export const importUrl = (file: string) => `/siege/imports/${file}.glb`;
