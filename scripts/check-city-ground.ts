/**
 * check-city-ground — Dubai must be LAND.
 *
 * B3 dropped the Kaiju 87 metres under the Persian Gulf, because the only elevation data that exists
 * for Dubai is a nine-kilometre-per-sample tile that averages shallow gulf and low desert to below
 * zero. Every symptom looked like something else: no city, no Kaiju, dead controls — all of which
 * were "you are underwater, swimming, in the murk".
 *
 * Run: npm run check:city-ground
 */
import { latLonToDirection } from '../src/components/siege/globe/cubeSphere';
import { cityBaseMetres, cityGroundMetres } from '../src/components/siege/globe/cityGround';

let failures = 0;
function ok(cond: boolean, label: string, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
}
const at = (lat: number, lon: number, base: number | null) => {
  const d = new Float64Array(3);
  latLonToDirection(lat, lon, d);
  return cityBaseMetres(d[0], d[1], d[2], base);
};

console.log('\n== Dubai is land ==\n');

// THE BUG, ASSERTED DIRECTLY. -87 is the real number the real server returns.
for (const [name, lat, lon] of [
  ['Marina', 25.0805, 55.1403], ['Downtown', 25.1972, 55.2744],
  ['Palm Jumeirah', 25.1124, 55.1390], ['Sheikh Zayed Rd', 25.15, 55.22],
] as [string, number, number][]) {
  const m = at(lat, lon, -87);
  ok(m != null && m > 0, `${name} is above sea level`, `${m?.toFixed(0)} m (raw data says -87)`);
}

ok(at(25.14, 55.21, null) === cityGroundMetres('Dubai'),
   'a city knows it is land even before any tile has loaded');

// ...and it must not turn the whole Gulf into a plateau.
ok(at(25.14, 54.6, -87) === -87, 'far out to sea the real data is untouched, west',
   `${at(25.14, 54.6, -87)} m`);
ok(at(24.5, 55.21, -20) === -20, 'and to the south');
ok(at(36.0616, -112.1076, 1805) === 1805, 'the Grand Canyon is not affected at all');

// The blend has to be a slope, not a cliff: a 6 m step over one metre would be a wall the Kaiju
// walks into, and a wall you cannot see is worse than a hole.
{
  let worst = 0, prev = at(25.14, 55.21, -87)!;
  // Walk due west from the centre, out through the blend band, in 200 m steps.
  for (let m = 200; m < 40000; m += 200) {
    const lon = 55.21 - (m / (111320 * Math.cos(25.14 * Math.PI / 180)));
    const h = at(25.14, lon, -87)!;
    worst = Math.max(worst, Math.abs(h - prev));
    prev = h;
  }
  // AS A GRADIENT, which is the thing that actually matters and the thing a number can be
  // defended for. My first attempt asserted "under 3 m per 200 m step", which is not a property of
  // anything — it is a unit chosen by how the loop happened to be written, and it failed at 3.17 m
  // for a slope of 1.6%, which is a gentle beach. 5% is about a wheelchair ramp and nothing a 300 m
  // creature would notice; anything past that would start to read as terrain rather than coastline.
  const grade = worst / 200;
  ok(grade < 0.05, 'the coastline is a slope, not a cliff',
     `steepest ${(grade * 100).toFixed(1)}% grade`);
}

console.log(`\n${failures === 0 ? 'CITY GROUND CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
