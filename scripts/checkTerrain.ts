// Numeric sanity check on the Starblink terrain generator. Run: npx esbuild + node (see below).
import { terrainHeight, biomeNameAt, MAX_HEIGHT_M } from '../src/features/starblink/terrainGen';
const SEED = 20260904;
let min = 1e9, max = -1e9, sum = 0, n = 0;
const counts: Record<string, number> = {};
for (let x = -16000; x <= 16000; x += 500) {
  for (let z = -16000; z <= 16000; z += 500) {
    const h = terrainHeight(x, z, SEED);
    min = Math.min(min, h); max = Math.max(max, h); sum += h; n++;
    const b = biomeNameAt(x, z, SEED); counts[b] = (counts[b] || 0) + 1;
  }
}
console.log(`samples=${n}  min=${min.toFixed(1)}  max=${max.toFixed(1)}  mean=${(sum / n).toFixed(1)}  (ceiling ${MAX_HEIGHT_M})`);
console.log('biome mix:', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / n * 100).toFixed(0)}%`).join('  '));
console.log('\ntransect east from the Fortress (every 200 m):');
let row = '';
for (let x = 0; x <= 4000; x += 200) row += `${x}:${terrainHeight(x, 0, SEED).toFixed(0)}m  `;
console.log(row);
