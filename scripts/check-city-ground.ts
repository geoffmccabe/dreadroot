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

// THE COASTLINE, which now exists. The earlier version of this check asserted the whole thing was
// a gentle slope — correct when the override was one flat disc, and wrong now: a coast is a STEP.
// What matters instead is how big that step is, and that the sea deepens smoothly beyond it.
{
  // Land is +6, coastal sea is -12, so the drop at the water's edge is 18 m — small enough to sit
  // under the water surface where nothing can see it. The failure this guards against is the drop
  // going back to the raw -87, which would put a 93 m cliff along the entire shore.
  const land = at(25.1972, 55.2744, -87)!;      // Downtown
  const sea = at(25.150, 55.050, -87)!;         // open Gulf, north-west
  ok(land - sea < 25, 'the step at the water\'s edge is small enough to hide under the sea surface',
     `${(land - sea).toFixed(0)} m drop`);
  ok(sea < 0 && sea > -30, 'coastal water is shallow, not an abyss', `${sea.toFixed(0)} m`);
}

// THE LAND MAP ITSELF. Geoff: "The palm is supposed to be a set of islands in the water but
// everything is inland." These four points are the whole shape of the answer.
{
  ok(at(25.1120, 55.1390, -87)! > 0, 'the Palm is land');
  ok(at(25.0805, 55.1403, -87)! > 0, 'the Marina is land');
  ok(at(25.150, 55.050, -87)! < 0, 'the Gulf offshore is WATER, not filled in');
  ok(at(24.950, 55.250, -87)! > 0, 'the desert inland is land, not drowned by the blend');
}

// And the sea must deepen smoothly out to the real data rather than stepping.
{
  let worst = 0, prev = at(25.150, 55.050, -87)!;
  for (let m = 200; m < 30000; m += 200) {
    const lon = 55.050 - (m / (111320 * Math.cos(25.15 * Math.PI / 180)));
    const h = at(25.150, lon, -87)!;
    worst = Math.max(worst, Math.abs(h - prev));
    prev = h;
  }
  ok(worst / 200 < 0.05, 'the sea floor deepens as a slope, not a cliff',
     `steepest ${((worst / 200) * 100).toFixed(1)}% grade`);
}

console.log(`\n${failures === 0 ? 'CITY GROUND CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
