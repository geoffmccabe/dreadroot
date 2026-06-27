// "Render" section for the Lightning Panel — live tone-mapping / bloom / IBL controls
// wired straight to lookStore (persisted). Styles mirror the panel's HUD tokens so it
// drops in seamlessly. Bloom is desktop-only (mobile skips the composer), noted inline.
import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useLook, lookStore, type ToneMappingChoice } from './lookStore';

const sectionStyle: React.CSSProperties = { marginBottom: '6px' };
const sectionTitleStyle: React.CSSProperties = {
  fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
  opacity: 0.7, marginBottom: '4px',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px',
};
const labelStyle: React.CSSProperties = { fontSize: '10px' };
const valueStyle: React.CSSProperties = { fontSize: '9px', fontFamily: 'monospace', opacity: 0.75 };
const btnStyle: React.CSSProperties = {
  padding: '2px 6px', fontSize: '9px', borderRadius: '3px',
  border: '1px solid hsla(var(--hud-border-h) / 0.6)', background: 'hsla(var(--hud-bg-h) / 0.3)',
  color: 'inherit', cursor: 'pointer', flex: 1,
};

const TONE_OPTIONS: { key: ToneMappingChoice; label: string }[] = [
  { key: 'agx', label: 'AgX' },
  { key: 'aces', label: 'ACES' },
  { key: 'neutral', label: 'Neut' },
  { key: 'linear', label: 'Lin' },
];

function SliderRow(props: {
  label: string; value: number; display: string;
  min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: '4px' }}>
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

export function LookControls() {
  const look = useLook();

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Render (Look)</div>

      {/* Tone mapping mode */}
      <div style={{ ...rowStyle, marginBottom: '4px' }}>
        <span style={labelStyle}>Tone</span>
      </div>
      <div style={{ display: 'flex', gap: '3px', marginBottom: '6px' }}>
        {TONE_OPTIONS.map((o) => {
          const active = look.toneMapping === o.key;
          return (
            <button
              key={o.key}
              style={{
                ...btnStyle,
                background: active ? 'hsla(var(--hud-border-h) / 0.55)' : btnStyle.background,
                fontWeight: active ? 700 : 400,
              }}
              onClick={() => lookStore.set('toneMapping', o.key)}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <SliderRow
        label="Exposure" value={look.exposure} display={look.exposure.toFixed(2)}
        min={0.3} max={2.0} step={0.05} onChange={(v) => lookStore.set('exposure', v)}
      />

      {/* Bloom */}
      <div style={rowStyle}>
        <span style={labelStyle}>Bloom (desktop)</span>
        <Switch
          checked={look.bloomEnabled}
          onCheckedChange={(v) => lookStore.set('bloomEnabled', v)}
          style={{ transform: 'scale(0.7)', transformOrigin: 'right center' }}
        />
      </div>
      <SliderRow
        label="• Intensity" value={look.bloomIntensity} display={look.bloomIntensity.toFixed(2)}
        min={0} max={2} step={0.05} onChange={(v) => lookStore.set('bloomIntensity', v)}
      />
      <SliderRow
        label="• Threshold" value={look.bloomThreshold} display={look.bloomThreshold.toFixed(2)}
        min={0} max={1} step={0.01} onChange={(v) => lookStore.set('bloomThreshold', v)}
      />
      <SliderRow
        label="• Radius" value={look.bloomRadius} display={look.bloomRadius.toFixed(2)}
        min={0} max={1} step={0.05} onChange={(v) => lookStore.set('bloomRadius', v)}
      />

      <SliderRow
        label="IBL (PBR amb.)" value={look.iblIntensity} display={look.iblIntensity.toFixed(2)}
        min={0} max={1.5} step={0.05} onChange={(v) => lookStore.set('iblIntensity', v)}
      />

      <button style={{ ...btnStyle, marginTop: '2px' }} onClick={() => lookStore.reset()}>
        Reset Look
      </button>
    </div>
  );
}
