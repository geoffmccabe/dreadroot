// GlobeLookControls — the Mini Earth lighting section of the Lightning Panel (Ctrl+L).
//
// Geoff: "see if you can work with what we already have to bring up the lighting panel and apply
// your various ideas to it, giving me the power to turn them on/off and adjust them, so they don't
// kill the game, and we can see which is doing what."
//
// Built into the existing panel rather than as a new one, and styled from the same tokens as
// LookControls next to it, because a second lighting panel is a second place to look.
//
// ORDERED BY HOW MUCH EACH ONE MATTERS, top to bottom, so the first thing anyone drags is the thing
// most likely to fix what they are looking at. The two Fill sliders are first for that reason: they
// are the actual cause of "washed out" and dragging them to zero is the single most dramatic change
// available here.

import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  useGlobeLook, globeLookStore, GLOBE_LOOK_DEFAULTS, GLOBE_LOOK_PRESETS, applyGlobePreset,
} from './globeLookStore';

const sectionStyle: React.CSSProperties = { marginBottom: '6px' };
const sectionTitleStyle: React.CSSProperties = {
  fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
  opacity: 0.7, marginBottom: '4px',
};
const groupTitleStyle: React.CSSProperties = {
  fontSize: '9px', fontWeight: 700, opacity: 0.55, marginTop: '6px', marginBottom: '2px',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px',
};
const labelStyle: React.CSSProperties = { fontSize: '10px' };
const valueStyle: React.CSSProperties = { fontSize: '9px', fontFamily: 'monospace', opacity: 0.75 };
const noteStyle: React.CSSProperties = {
  fontSize: '9px', opacity: 0.5, lineHeight: 1.35, marginBottom: '4px',
};
const btnStyle: React.CSSProperties = {
  padding: '2px 6px', fontSize: '9px', borderRadius: '3px',
  border: '1px solid hsla(var(--hud-border-h) / 0.6)', background: 'hsla(var(--hud-bg-h) / 0.3)',
  color: 'inherit', cursor: 'pointer',
};

function ToggleRow({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function SliderRow(props: {
  label: string; value: number; display: string;
  min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div style={{ marginBottom: '4px', opacity: props.disabled ? 0.4 : 1 }}>
      <div style={rowStyle}>
        <span style={labelStyle}>{props.label}</span>
        <span style={valueStyle}>{props.display}</span>
      </div>
      <Slider
        value={[props.value]}
        onValueChange={([v]) => props.onChange(v)}
        min={props.min} max={props.max} step={props.step}
        className="w-full"
      />
    </div>
  );
}

export function GlobeLookControls() {
  const g = useGlobeLook();
  const set = globeLookStore.set;

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Mini Earth Lighting</div>

      <ToggleRow label="Enable (master)" value={g.enabled} onChange={(v) => set('enabled', v)} />
      {!g.enabled && (
        <div style={noteStyle}>
          Off = the map exactly as it has always been. Everything below does nothing until this is on.
        </div>
      )}

      {g.enabled && (
        <>
          {/* --- PRESETS ----------------------------------------------------------------------- */}
          <div style={groupTitleStyle}>Presets — start here</div>
          <div style={{ display: 'flex', gap: '3px', marginBottom: '4px' }}>
            {GLOBE_LOOK_PRESETS.map((p) => (
              <button key={p.key} style={{ ...btnStyle, flex: 1 }} onClick={() => applyGlobePreset(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={noteStyle}>
            Each sets every slider below at once. Pick the nearest and then adjust — building a look
            from defaults every time is a lot of dragging for no reason.
          </div>

          {/* --- THE ONE THAT WAS MISSING ------------------------------------------------------ */}
          <div style={groupTitleStyle}>World lights — why it would never go dark</div>
          <div style={noteStyle}>
            This map carries three lights of its own (ambient, hemisphere and a sun) added to EVERY
            world, and they were not on this panel — so turning my sun off still left it lit by
            somebody else's midday. Drag this down for night.
          </div>
          <SliderRow
            label="World lights" value={g.worldLights} display={`${(g.worldLights * 100).toFixed(0)}%`}
            min={0} max={1} step={0.01} onChange={(v) => set('worldLights', v)}
          />
          <div style={rowStyle}>
            <span style={labelStyle}>Sky</span>
            <div style={{ display: 'flex', gap: '3px' }}>
              {(['default', 'night'] as const).map((m) => (
                <button
                  key={m}
                  style={{ ...btnStyle, opacity: g.skyMode === m ? 1 : 0.5 }}
                  onClick={() => set('skyMode', m)}
                >
                  {m === 'default' ? 'Day dome' : 'Night'}
                </button>
              ))}
            </div>
          </div>
          <div style={noteStyle}>
            The blue background and the midday sky dome are not LIT — they are bright in themselves,
            so dimming lights never touches them. Night hides the dome and goes dark, which is what
            lets the city's window lights be the brightest thing on screen.
          </div>

          {/* --- THE BIG ONE ------------------------------------------------------------------- */}
          <div style={groupTitleStyle}>Flat fill — the cause of "washed out"</div>
          <div style={noteStyle}>
            The globe is lit as a builder map: a bright fill with no direction, so nothing has a
            bright side and a dark side. Drag both to zero first.
          </div>
          <SliderRow
            label="Ambient" value={g.fillAmbient} display={g.fillAmbient.toFixed(2)}
            min={0} max={1.2} step={0.01} onChange={(v) => set('fillAmbient', v)}
          />
          <SliderRow
            label="Hemisphere" value={g.fillHemi} display={g.fillHemi.toFixed(2)}
            min={0} max={1.2} step={0.01} onChange={(v) => set('fillHemi', v)}
          />

          {/* --- SUN --------------------------------------------------------------------------- */}
          <div style={groupTitleStyle}>Sun</div>
          <ToggleRow label="Sun on" value={g.sunOn} onChange={(v) => set('sunOn', v)} />
          <SliderRow
            label="Intensity" value={g.sunIntensity} display={g.sunIntensity.toFixed(2)}
            min={0} max={6} step={0.05} disabled={!g.sunOn}
            onChange={(v) => set('sunIntensity', v)}
          />
          <SliderRow
            label="Elevation" value={g.sunElevation} display={`${g.sunElevation.toFixed(0)}°`}
            min={-5} max={85} step={1} disabled={!g.sunOn}
            onChange={(v) => set('sunElevation', v)}
          />
          <div style={noteStyle}>
            Low = golden hour: long shadows raking across the terrain, every ridge separated into a
            lit and an unlit face. High = midday: short shadows, flat cliffs.
          </div>
          <SliderRow
            label="Bearing" value={g.sunBearing} display={`${g.sunBearing.toFixed(0)}°`}
            min={0} max={359} step={1} disabled={!g.sunOn}
            onChange={(v) => set('sunBearing', v)}
          />
          <SliderRow
            label="Warmth" value={g.sunWarmth} display={g.sunWarmth.toFixed(2)}
            min={0} max={1} step={0.01} disabled={!g.sunOn}
            onChange={(v) => set('sunWarmth', v)}
          />
          <SliderRow
            label="Sky bounce" value={g.skyBounce} display={g.skyBounce.toFixed(2)}
            min={0} max={1.5} step={0.01} onChange={(v) => set('skyBounce', v)}
          />

          {/* --- SHADOWS ----------------------------------------------------------------------- */}
          <div style={groupTitleStyle}>Shadows</div>
          <ToggleRow label="Shadows on" value={g.shadowsOn} onChange={(v) => set('shadowsOn', v)} />
          <ToggleRow label="Soft edges" value={g.shadowSoft} onChange={(v) => set('shadowSoft', v)} />
          <SliderRow
            label="Area covered" value={g.shadowSpanM} display={`${(g.shadowSpanM / 1000).toFixed(1)} km`}
            min={500} max={12000} step={100} disabled={!g.shadowsOn}
            onChange={(v) => set('shadowSpanM', v)}
          />
          <div style={noteStyle}>
            Smaller = sharper, but shadows stop existing further out. Kaiju cast; soldiers only
            receive (at 1.8 m their shadow is about one pixel of the map).
          </div>

          {/* --- GROUND ------------------------------------------------------------------------ */}
          <div style={groupTitleStyle}>Ground material</div>
          <ToggleRow label="Lit ground (PBR)" value={g.terrainPbr} onChange={(v) => set('terrainPbr', v)} />
          <div style={noteStyle}>
            The terrain has NO textures — every colour is per-vertex, smeared over triangles hundreds
            of metres wide, on the flattest material three.js has. This swaps it for one that can
            catch light and adds procedural detail. Biggest change here, and the riskiest: it also
            picks up scene lighting the old one ignored, so retune the sun AFTER turning it on.
          </div>
          <SliderRow
            label="Surface relief" value={g.terrainNormal} display={g.terrainNormal.toFixed(2)}
            min={0} max={2} step={0.02} disabled={!g.terrainPbr}
            onChange={(v) => set('terrainNormal', v)}
          />
          <SliderRow
            label="Detail" value={g.terrainDetail} display={g.terrainDetail.toFixed(2)}
            min={0} max={1.5} step={0.02} disabled={!g.terrainPbr}
            onChange={(v) => set('terrainDetail', v)}
          />
          <SliderRow
            label="Rock strata" value={g.terrainStrata} display={g.terrainStrata.toFixed(2)}
            min={0} max={1.5} step={0.02} disabled={!g.terrainPbr}
            onChange={(v) => set('terrainStrata', v)}
          />
          <SliderRow
            label="Strata band" value={g.terrainStrataM} display={`${g.terrainStrataM.toFixed(0)} m`}
            min={10} max={200} step={5} disabled={!g.terrainPbr}
            onChange={(v) => set('terrainStrataM', v)}
          />
          <SliderRow
            label="Cavity (AO)" value={g.terrainCavity} display={g.terrainCavity.toFixed(2)}
            min={0} max={1} step={0.02} disabled={!g.terrainPbr}
            onChange={(v) => set('terrainCavity', v)}
          />
          <SliderRow
            label="Environment" value={g.terrainEnv} display={g.terrainEnv.toFixed(2)}
            min={0} max={1} step={0.01} disabled={!g.terrainPbr}
            onChange={(v) => set('terrainEnv', v)}
          />
          <SliderRow
            label="Brightness" value={g.terrainBrightness} display={`${g.terrainBrightness.toFixed(2)}x`}
            min={0.1} max={1.5} step={0.01} disabled={!g.terrainPbr}
            onChange={(v) => set('terrainBrightness', v)}
          />
          <div style={noteStyle}>
            If PBR blows out to white, Environment is the first thing to try — the scene's ambient
            light is a bright white box that the old material ignored completely and this one does
            not. It starts at 0 for that reason. Brightness is the blunt instrument after it.
          </div>

          {/* --- HAZE -------------------------------------------------------------------------- */}
          <div style={groupTitleStyle}>Aerial haze</div>
          <ToggleRow label="Haze on" value={g.hazeOn} onChange={(v) => set('hazeOn', v)} />
          <SliderRow
            label="Visibility" value={g.hazeVisibilityKm} display={`${g.hazeVisibilityKm.toFixed(0)} km`}
            min={20} max={600} step={10} disabled={!g.hazeOn}
            onChange={(v) => set('hazeVisibilityKm', v)}
          />
          <SliderRow
            label="Ceiling" value={g.hazeCeilingKm} display={`${g.hazeCeilingKm.toFixed(0)} km`}
            min={2} max={40} step={1} disabled={!g.hazeOn}
            onChange={(v) => set('hazeCeilingKm', v)}
          />
          <div style={noteStyle}>
            Distance haze is what makes a landscape feel vast. Lower Visibility = thicker haze; if
            it reads as a white wall, raise it. Above the Ceiling there is none at all — set that too
            high and the whole planet fogs white from orbit, which is exactly what it did.
          </div>

          {/* --- GRADE ------------------------------------------------------------------------- */}
          <div style={groupTitleStyle}>Grade</div>
          <ToggleRow label="Grade on" value={g.gradeOn} onChange={(v) => set('gradeOn', v)} />
          <SliderRow
            label="Exposure" value={g.exposure} display={g.exposure.toFixed(2)}
            min={0.3} max={2} step={0.01} disabled={!g.gradeOn}
            onChange={(v) => set('exposure', v)}
          />
          <SliderRow
            label="Contrast" value={g.contrast} display={g.contrast.toFixed(2)}
            min={-0.5} max={0.6} step={0.01} disabled={!g.gradeOn}
            onChange={(v) => set('contrast', v)}
          />
          <SliderRow
            label="Saturation" value={g.saturation} display={g.saturation.toFixed(2)}
            min={-1} max={0.6} step={0.01} disabled={!g.gradeOn}
            onChange={(v) => set('saturation', v)}
          />
          <SliderRow
            label="Vignette" value={g.vignette} display={g.vignette.toFixed(2)}
            min={0} max={1.2} step={0.01} disabled={!g.gradeOn}
            onChange={(v) => set('vignette', v)}
          />

          {/* --- RESOLUTION -------------------------------------------------------------------- */}
          <div style={groupTitleStyle}>Resolution</div>
          <SliderRow
            label="Render scale" value={g.dpr} display={`${g.dpr.toFixed(2)}x`}
            min={1} max={2} step={0.25} onChange={(v) => set('dpr', v)}
          />
          <div style={noteStyle}>
            The game draws at 1x with antialiasing off, so on a Retina screen it renders at half your
            display's resolution and stretches it up — a blur over everything, before any lighting
            question. 2x is native and costs four times the pixels.
          </div>

          {/* --- CLOUDS ------------------------------------------------------------------------ */}
          <div style={groupTitleStyle}>Clouds — known broken</div>
          <ToggleRow label="Clouds on" value={g.cloudsOn} onChange={(v) => set('cloudsOn', v)} />
          <div style={noteStyle}>
            Two decks at real altitudes you can fly through. They currently paint over the terrain,
            and not because of the clouds: this camera's near plane can be 3 cm while its far plane is
            hundreds of thousands of units, and a depth buffer over that range cannot sort anything at
            planetary distance. Left switchable so it can be seen rather than taken on trust.
          </div>
          <SliderRow
            label="Coverage" value={g.cloudCoverage} display={g.cloudCoverage.toFixed(2)}
            min={0} max={0.9} step={0.01} disabled={!g.cloudsOn}
            onChange={(v) => set('cloudCoverage', v)}
          />
          <SliderRow
            label="Opacity" value={g.cloudOpacity} display={g.cloudOpacity.toFixed(2)}
            min={0} max={1} step={0.01} disabled={!g.cloudsOn}
            onChange={(v) => set('cloudOpacity', v)}
          />

          <button
            style={{ ...btnStyle, width: '100%', marginTop: '6px' }}
            onClick={() => globeLookStore.reset()}
          >
            Reset to defaults ({GLOBE_LOOK_DEFAULTS.enabled ? 'on' : 'all off'})
          </button>
        </>
      )}
    </div>
  );
}
