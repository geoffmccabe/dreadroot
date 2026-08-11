// KaijuCityPanel — what this site IS, on screen.
//
// Geoff: "Each city will also have its own other details like how many kaijus, what size, what
// strength, and details about the soldiers... how many, what they do, etc. So all of that will be in
// a CITY panel for each city."
//
// It reads the site definition and nothing else. That is the point: if this panel says a city has
// 9,000 cars and 200 soldiers, then it has, because the same object is what the renderers and the
// arena read. A panel that reports from a separate copy of the numbers is a panel that will
// eventually lie, and a lying diagnostic is worse than none.
//
// IT ALSO LISTS THE FORCES THAT DO NOT EXIST YET — helicopters, tanks, humvees, jets — showing 0.
// That is deliberate. A field that reads "0" tells you the game knows about the thing and this city
// has none; a field that is absent tells you nothing, and hides the fact that a city file could ask
// for them. It is the roadmap and the config in the same place.

import { useSyncExternalStore } from 'react';
import { useDraggablePanel } from '../useDraggablePanel';
import { panelLeft, panelStyle, kaijuColour } from './kaijuPanelLayout';
import { currentSite, subscribeSite, siteVersion, currentStopIndex, SITES } from './sites';
import { BREEDS } from './kaijuStats';
import { WEAPONS } from './kaijuWeapons';

/** Sits above the Talk panel, so the column reads: City, Talk, Lab, Tracker. */
const CITY_TOP = 8;
const CITY_MAX_H = 180;

export function KaijuCityPanel() {
  useSyncExternalStore(subscribeSite, siteVersion, siteVersion);
  const { pos, handleProps } = useDraggablePanel({ left: panelLeft(), top: CITY_TOP });
  const site = currentSite();

  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ opacity: 0.75 }}>{label}</span><span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );

  // Nothing to say until you have gone somewhere. Listing every site before you have pressed a key
  // would put a wall of text over the planet on load.
  if (!site) {
    return (
      <div style={panelStyle(pos.left, pos.top, 43, CITY_MAX_H)}>
        <div {...handleProps} style={{ cursor: 'move', fontWeight: 700, marginBottom: 6 }}>CITY</div>
        <div style={{ opacity: 0.7 }}>
          Press <b>B</b> then a number to go somewhere:
          <div style={{ marginTop: 4, lineHeight: 1.6 }}>
            {SITES.map((s) => (
              <div key={s.slug}>
                <b>B{s.key.slice(-1)}</b> {s.name}
                {s.city ? ` · ${s.city.stops.length} districts` : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const g = site.garrison;
  const c = site.city;
  const stop = c?.stops[currentStopIndex(site.slug)];
  // Only the forces that exist here, so a site with none says "none" once rather than four zeros.
  const vehicles = ([
    ['humvees', g.humvees], ['tanks', g.tanks], ['helicopters', g.helicopters], ['jets', g.jets],
  ] as const).filter(([, n]) => n > 0);

  return (
    <div style={panelStyle(pos.left, pos.top, 43, CITY_MAX_H)}>
      <div {...handleProps} style={{ cursor: 'move', fontWeight: 700, marginBottom: 4 }}>
        CITY · B{site.key.slice(-1)} · {site.name}
      </div>
      <div style={{ opacity: 0.7, marginBottom: 6, lineHeight: 1.35 }}>{site.blurb}</div>

      {stop && row('District', `${stop.name} (${(currentStopIndex(site.slug) + 1)}/${c!.stops.length})`)}
      {stop?.note && <div style={{ opacity: 0.6, fontSize: '0.9em', marginBottom: 4 }}>{stop.note}</div>}
      {row('Where', `${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}`)}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', margin: '6px 0' }} />
      <div style={{ opacity: 0.85, marginBottom: 2 }}>The fight</div>
      {site.battle.roster.map((k, i) => {
        const b = BREEDS[k.breed];
        if (!b) return null;
        const h = k.heightUnits ?? 3;
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              {/* Same colour as the tracker's tabs and the minimap's dots, so all three agree. */}
              <span style={{ color: kaijuColour(i) }}>■</span> {b.name}{i === 0 ? ' (you)' : ''}
            </span>
            <span style={{ opacity: 0.75 }}>
              {Math.round(h * 100)} m · {WEAPONS[k.weapon ?? b.weapon].name}
              {k.healthMul && k.healthMul !== 1 ? ` · ${k.healthMul}x hp` : ''}
              {k.damageMul && k.damageMul !== 1 ? ` · ${k.damageMul}x dmg` : ''}
            </span>
          </div>
        );
      })}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', margin: '6px 0' }} />
      <div style={{ opacity: 0.85, marginBottom: 2 }}>The garrison</div>
      {row('Soldiers', g.soldiers ? `${g.soldiers}, ${g.layout}` : 'none')}
      {g.soldiers > 0 && row('Fire rate', g.fireRate > 0 ? `${g.fireRate}/s each` : 'civilians, unarmed')}
      {/* Not built yet, and saying so beats showing four zeros as though they were tuned. */}
      {row('Vehicles', vehicles.length ? vehicles.map(([n, v]) => `${v} ${n}`).join(', ') : 'none yet')}
      {g.note && <div style={{ opacity: 0.6, fontSize: '0.9em', marginTop: 3 }}>{g.note}</div>}

      {c && (
        <>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', margin: '6px 0' }} />
          <div style={{ opacity: 0.85, marginBottom: 2 }}>The city</div>
          {row('Assets', Object.entries(c.assets).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none')}
          {/* Traffic RIDES the road network, so a city without roads baked has none however many
              vehicles its config asks for. Saying "3,500 vehicles" over an empty street map is the
              panel lying, which is the one thing it must never do. */}
          {row('Traffic', !c.assets.roads ? 'none — roads not baked'
            : c.cars ? `${c.cars.toLocaleString()} vehicles` : 'none')}
          {row('Roof beacons', `above ${c.beaconMinHeightMetres} m`)}
          {row('Ground', `${site.ground.groundMetres} m, sea ${site.ground.shallowSeaMetres} m`)}
          {row('Draw within', `${c.drawWithinUnits} u (${c.drawWithinUnits / 10} km)`)}
        </>
      )}
    </div>
  );
}
