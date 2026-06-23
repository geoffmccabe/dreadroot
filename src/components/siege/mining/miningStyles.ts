// miningStyles — crystal models (by colour) for the Admin Mining node types + in-world rendering.
// Colours map to ore tiers; the converted PurePoly Mining crystals carry baked texture + glow.
export interface MiningStyle { id: string; label: string; file: string; }

export const MINING_STYLES: MiningStyle[] = [
  { id: 'copper', label: 'Copper (orange)', file: 'mining_PP_Crystal_Cluster_01_Copper.gltf' },
  { id: 'iron',   label: 'Iron (grey)',     file: 'mining_PP_Crystal_Cluster_01_Iron.gltf' },
  { id: 'silver', label: 'Silver (white)',  file: 'mining_PP_Crystal_Cluster_01_Silver.gltf' },
  { id: 'gold',   label: 'Gold (yellow)',   file: 'mining_PP_Crystal_Cluster_01_Gold.gltf' },
  { id: 'green',  label: 'Green (emerald)', file: 'mining_PP_Crystal_Cluster_01_Green.gltf' },
  { id: 'blue',   label: 'Blue (sapphire)', file: 'mining_PP_Crystal_Cluster_01_Blue.gltf' },
  { id: 'red',    label: 'Red (ruby)',      file: 'mining_PP_Crystal_Cluster_01_Red.gltf' },
];
