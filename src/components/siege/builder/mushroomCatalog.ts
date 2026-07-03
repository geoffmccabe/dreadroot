// The mushroom-TREE models (public/siege/imports) available to the Model Placer + the Procedural
// Generator. Khaured Tower is intentionally excluded (it's a structure, not a tree). One list, so the
// manual palette and the PG stay in sync as we add species.
export const MUSHROOM_TREES: string[] = [
  'mushroomtree05', 'mushroomtree06', 'mushroomtree07', 'MushroomTree_A', 'Tree1',
  'vasim_tree1_collider', 'vasim_tree1_collider_feb25', 'vasim_tree1_collider2', 'vasim_tree1_flat',
  'jhay_tree1', 'jhay_tree2', 'jhay_tree3', 'jhay_tree4', 'jhay_tree5', 'jhay_tree6',
  'meshes_tree05_tall', 'meshes_tree06_tall', 'ashley_tree05', 'mushrooms2_tree06',
  'mushroom_line_straight',
];
export const importUrl = (file: string) => `/siege/imports/${file}.glb`;
