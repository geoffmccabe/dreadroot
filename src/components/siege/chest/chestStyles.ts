// chestStyles — selectable chest models for the Admin Chests panel + in-world rendering. Each
// style is a base mesh (+ an optional separate lid mesh for the open/close animation). Files live
// under /siege/scifi/.
export interface ChestStyle { id: string; label: string; base: string; lid?: string; }

export const CHEST_STYLES: ChestStyle[] = [
  { id: 'kingdom_01', label: 'Medieval (Kingdom)', base: 'kingdom_SM_Prop_Chest_01.gltf', lid: 'kingdom_SM_Prop_Chest_01_Lid.gltf' },
  { id: 'kingdom_02', label: 'Medieval Ornate',     base: 'kingdom_SM_Prop_Chest_02.gltf', lid: 'kingdom_SM_Prop_Chest_02_Lid.gltf' },
  { id: 'adventure',  label: 'Adventure',           base: 'adventure_SM_Prop_Chest_01.gltf', lid: 'adventure_SM_Prop_Chest_Lid_01.gltf' },
  { id: 'dark',       label: 'Dark Fantasy',        base: 'dark_SM_Prop_Chest_01.gltf' },
  { id: 'nature',     label: 'Wooden (Nature)',     base: 'nature_SM_Prop_Chest_Wood_01.gltf' },
  { id: 'samurai',    label: 'Samurai',             base: 'samurai_SM_Prop_Chest_01.gltf' },
];

export const chestStyle = (id: string): ChestStyle => CHEST_STYLES.find((s) => s.id === id) ?? CHEST_STYLES[0];
