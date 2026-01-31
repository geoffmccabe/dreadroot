import React, { useCallback, useMemo } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { LightningSettings, CycleState } from './FortressTypes';
import { diagnostics } from '@/lib/diagnosticsLogger';

interface LightningPanelProps {
  open: boolean;
  onClose: () => void;
  settings: LightningSettings;
  onSettingsChange: <K extends keyof LightningSettings>(key: K, value: LightningSettings[K]) => void;
  cycleState: CycleState;
  fps?: number;
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  right: '8px',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 30,
  width: '200px',
  maxHeight: '90vh',
  borderRadius: '6px',
  border: '1px solid hsla(211, 34%, 73%, 0.8)',
  background: 'hsla(211, 30%, 51%, 0.35)',
  backdropFilter: 'blur(8px)',
  color: 'hsl(211, 32%, 90%)',
  fontFamily: 'Inter, sans-serif',
  fontSize: '10px',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid hsla(211, 34%, 73%, 0.4)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  padding: '6px 8px',
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '6px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  opacity: 0.7,
  marginBottom: '4px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '3px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '10px',
};

const valueStyle: React.CSSProperties = {
  fontSize: '9px',
  fontFamily: 'monospace',
  opacity: 0.75,
};

const btnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '9px',
  borderRadius: '3px',
  border: '1px solid hsla(211, 34%, 73%, 0.6)',
  background: 'hsla(211, 30%, 51%, 0.3)',
  color: 'inherit',
  cursor: 'pointer',
  flex: 1,
};

export function LightningPanel({ open, onClose, settings, onSettingsChange, cycleState, fps }: LightningPanelProps) {
  const handleCopyDiagnostics = useCallback(() => {
    const data = {
      timestamp: new Date().toISOString(),
      lightningSettings: settings,
      cycleState,
      fps,
      userAgent: navigator.userAgent,
      screen: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
  }, [settings, cycleState, fps]);

  const handleResetDefaults = useCallback(() => {
    onSettingsChange('fogStartPct', 50);
    onSettingsChange('fogEndPct', 95);
    onSettingsChange('fogDayColor', '#cccccc');
    onSettingsChange('fogNightColor', '#222233');
    onSettingsChange('fogEnabled', true);
    onSettingsChange('lightingOverride', null);
    onSettingsChange('freezeCycle', false);
  }, [onSettingsChange]);

  const renderDistBlocks = useMemo(() => settings.visualDistance * 16, [settings.visualDistance]);
  const fogStartBlocks = useMemo(() => Math.round(renderDistBlocks * settings.fogStartPct / 100), [renderDistBlocks, settings.fogStartPct]);
  const fogEndBlocks = useMemo(() => Math.round(renderDistBlocks * settings.fogEndPct / 100), [renderDistBlocks, settings.fogEndPct]);
  const currentLighting = settings.lightingOverride !== null ? settings.lightingOverride : cycleState.lightingPercentage;

  if (!open) return null;

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: '11px', fontWeight: 600 }}>Lightning Panel</span>
        <span
          onClick={onClose}
          style={{ cursor: 'pointer', fontSize: '13px', lineHeight: 1, opacity: 0.6 }}
        >
          x
        </span>
      </div>

      {/* Scrollable body */}
      <div style={bodyStyle}>

        {/* FOG */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Fog</div>
          <div style={rowStyle}>
            <span style={labelStyle}>Enabled</span>
            <Switch
              checked={settings.fogEnabled}
              onCheckedChange={(v) => onSettingsChange('fogEnabled', v)}
              style={{ transform: 'scale(0.7)', transformOrigin: 'right center' }}
            />
          </div>
          <div style={{ marginBottom: '4px' }}>
            <div style={rowStyle}>
              <span style={labelStyle}>Start</span>
              <span style={valueStyle}>{settings.fogStartPct}% ({fogStartBlocks}b)</span>
            </div>
            <Slider
              value={[settings.fogStartPct]}
              onValueChange={([v]) => onSettingsChange('fogStartPct', v)}
              min={0} max={100} step={1}
              className="w-full"
            />
          </div>
          <div style={{ marginBottom: '4px' }}>
            <div style={rowStyle}>
              <span style={labelStyle}>End</span>
              <span style={valueStyle}>{settings.fogEndPct}% ({fogEndBlocks}b)</span>
            </div>
            <Slider
              value={[settings.fogEndPct]}
              onValueChange={([v]) => onSettingsChange('fogEndPct', v)}
              min={0} max={100} step={1}
              className="w-full"
            />
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '2px' }}>
            <div style={{ flex: 1 }}>
              <span style={{ ...labelStyle, fontSize: '9px' }}>Day</span>
              <input
                type="color"
                value={settings.fogDayColor}
                onChange={(e) => onSettingsChange('fogDayColor', e.target.value)}
                style={{ width: '100%', height: '18px', border: 'none', cursor: 'pointer', borderRadius: '2px' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ ...labelStyle, fontSize: '9px' }}>Night</span>
              <input
                type="color"
                value={settings.fogNightColor}
                onChange={(e) => onSettingsChange('fogNightColor', e.target.value)}
                style={{ width: '100%', height: '18px', border: 'none', cursor: 'pointer', borderRadius: '2px' }}
              />
            </div>
          </div>
        </div>

        {/* RENDER DISTANCE */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Render</div>
          <div style={rowStyle}>
            <span style={labelStyle}>Chunks</span>
            <span style={valueStyle}>{settings.visualDistance} ({renderDistBlocks}b)</span>
          </div>
          <Slider
            value={[settings.visualDistance]}
            onValueChange={([v]) => onSettingsChange('visualDistance', v)}
            min={2} max={20} step={1}
            className="w-full"
          />
        </div>

        {/* DAY/NIGHT */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Day / Night</div>
          <div style={rowStyle}>
            <span style={labelStyle}>Freeze</span>
            <Switch
              checked={settings.freezeCycle}
              onCheckedChange={(v) => {
                onSettingsChange('freezeCycle', v);
                if (v && settings.lightingOverride === null) {
                  onSettingsChange('lightingOverride', Math.round(cycleState.lightingPercentage));
                }
                if (!v) {
                  onSettingsChange('lightingOverride', null);
                }
              }}
              style={{ transform: 'scale(0.7)', transformOrigin: 'right center' }}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Light</span>
            <span style={valueStyle}>
              {Math.round(currentLighting)}%{settings.lightingOverride !== null ? ' M' : ''}
            </span>
          </div>
          <Slider
            value={[settings.lightingOverride !== null ? settings.lightingOverride : Math.round(cycleState.lightingPercentage)]}
            onValueChange={([v]) => {
              onSettingsChange('lightingOverride', v);
              if (!settings.freezeCycle) onSettingsChange('freezeCycle', true);
            }}
            min={0} max={100} step={1}
            className="w-full"
          />
        </div>

        {/* DIAGNOSTICS */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Info</div>
          <div style={{ fontFamily: 'monospace', fontSize: '9px', lineHeight: 1.6 }}>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>FPS</span><span>{fps ?? '—'}</span></div>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>Lighting</span><span>{currentLighting.toFixed(1)}%</span></div>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>Night</span><span>{cycleState.isNight ? 'Y' : 'N'}</span></div>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>Fog</span><span>{fogStartBlocks}–{fogEndBlocks}b</span></div>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>Dist</span><span>{settings.visualDistance}ch / {renderDistBlocks}b</span></div>
          </div>
        </div>

        {/* BUTTONS */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={btnStyle} onClick={handleResetDefaults}>Reset</button>
          <button style={btnStyle} onClick={handleCopyDiagnostics}>Copy</button>
        </div>
      </div>
    </div>
  );
}
