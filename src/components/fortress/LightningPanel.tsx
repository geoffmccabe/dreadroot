import React, { useCallback, useMemo, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { LightningSettings, CycleState } from './FortressTypes';
import { LookControls } from '@/features/look/LookControls';
import { useDraggablePanel } from '@/components/siege/useDraggablePanel';

interface LightningPanelProps {
  open: boolean;
  onClose: () => void;
  settings: LightningSettings;
  onSettingsChange: <K extends keyof LightningSettings>(key: K, value: LightningSettings[K]) => void;
  cycleState: CycleState;
  fps?: number;
}

// Readable light surface + very-dark-blue text (the old hud-text white vanished against the bright
// SWW scene). Position comes from useDraggablePanel (movable); body collapses (expandable).
const panelStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 30,
  width: '200px',
  maxHeight: '90vh',
  borderRadius: '6px',
  border: '1px solid rgba(10,26,58,0.25)',
  background: 'rgba(236,240,248,0.96)',
  backdropFilter: 'blur(8px)',
  color: '#0a1a3a',
  fontFamily: 'Inter, sans-serif',
  fontSize: '10px',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
};

const headerStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid rgba(10,26,58,0.18)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexShrink: 0,
  userSelect: 'none',
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
  border: '1px solid rgba(10,26,58,0.3)',
  background: 'rgba(10,26,58,0.06)',
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
    onSettingsChange('fogEnabled', true);
    onSettingsChange('lightingOverride', null);
    onSettingsChange('freezeCycle', false);
  }, [onSettingsChange]);

  const renderDistBlocks = useMemo(() => settings.visualDistance * 16, [settings.visualDistance]);
  const currentLighting = settings.lightingOverride !== null ? settings.lightingOverride : cycleState.lightingPercentage;

  // Movable (drag the header) + collapsible (caret in the header), per the panel rules.
  const { pos, handleProps } = useDraggablePanel({ left: typeof window !== 'undefined' ? window.innerWidth - 216 : 1000, top: 80 });
  const [collapsed, setCollapsed] = useState(false);

  if (!open) return null;

  return (
    <div style={{ ...panelStyle, left: pos.left, top: pos.top }}>
      {/* Header — drag handle (move) + collapse caret (expand/collapse) + close */}
      <div style={headerStyle} {...handleProps}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700 }}>
          <span
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed((c) => !c)}
            style={{ cursor: 'pointer', fontSize: '10px', width: '10px', opacity: 0.8 }}
          >
            {collapsed ? '▸' : '▾'}
          </span>
          LIGHTING &amp; RENDERING
        </span>
        <span
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          style={{ cursor: 'pointer', fontSize: '13px', lineHeight: 1, opacity: 0.6 }}
        >
          ×
        </span>
      </div>

      {/* Scrollable body */}
      {!collapsed && (
      <div style={bodyStyle}>

        {/* FOG — only Enabled is live. Density is auto (height-aware) and colour is
            derived from the sky every frame, so the old Start/End/Day/Night controls
            were dead (read but never applied) and were removed. See FOG_PLAN.md. */}
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
        </div>

        {/* RENDER DISTANCE */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Render Dist</div>
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

        {/* RENDER (LOOK) — tone mapping, bloom, IBL (lookStore) */}
        <LookControls />

        {/* DIAGNOSTICS */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Info</div>
          <div style={{ fontFamily: 'monospace', fontSize: '9px', lineHeight: 1.6 }}>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>FPS</span><span>{fps ?? '—'}</span></div>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>Lighting</span><span>{currentLighting.toFixed(1)}%</span></div>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>Night</span><span>{cycleState.isNight ? 'Y' : 'N'}</span></div>
            <div style={rowStyle}><span style={{ opacity: 0.5 }}>Dist</span><span>{settings.visualDistance}ch / {renderDistBlocks}b</span></div>
          </div>
        </div>

        {/* BUTTONS */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={btnStyle} onClick={handleResetDefaults}>Reset</button>
          <button style={btnStyle} onClick={handleCopyDiagnostics}>Copy</button>
        </div>
      </div>
      )}
    </div>
  );
}
