import React, { useCallback, useMemo, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { LightningSettings, CycleState } from './FortressTypes';
import { LookControls } from '@/features/look/LookControls';
import { GlobeLookControls } from '@/features/look/GlobeLookControls';
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
/**
 * THE SHELL, on the shared debug-panel look rather than its own.
 *
 * Geoff: "The style/css of the lighting panel is very old and was never fixed to update to our new
 * styling. Can you fix that now to match what we have in the kaiju section."
 *
 * It was a light panel — near-white glass, navy text, Inter — from before the debug surfaces were
 * unified. Everything else diagnostic in this game is dark glass with monospace body text, driven by
 * the --pt-debug-* tokens so the CSS editor restyles every panel at once. This one was the last
 * holdout, which is why it looked pasted in from another application.
 *
 * The surface now comes from the `.debug-panel` class, so it is not merely a copy of the Kaiju
 * panel's colours — it is the SAME source, and any future change to the tokens moves this with it.
 * Only layout stays here, which is the division that class already documents.
 */
const panelStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 30,
  width: '218px',
  maxHeight: '86vh',
  display: 'flex',
  flexDirection: 'column',
  fontSize: 'var(--pt-debug-body-size)',
  pointerEvents: 'auto',
};

const headerStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--pt-debug-border)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexShrink: 0,
  userSelect: 'none',
  cursor: 'move',
  fontWeight: 700,
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
  fontFamily: 'var(--pt-debug-body-family)',
  opacity: 0.75,
};

/**
 * Buttons match the Look and Kaiju sections exactly, token for token.
 *
 * They were navy-on-near-white, which on a dark surface would have been invisible. The HUD tokens
 * are the same ones the sections below this file already use, so a button in the panel header and a
 * button in the Mini Earth section are now the same object rather than two that resemble each other.
 */
const btnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '9px',
  borderRadius: '3px',
  border: '1px solid hsla(var(--hud-border-h) / 0.6)',
  background: 'hsla(var(--hud-bg-h) / 0.3)',
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
  /**
   * Opens on the LEFT, as asked. The Kaiju panels dock right — this and those are read together
   * while tuning a look, and two stacks on the same edge means one covers the other.
   */
  const { pos, handleProps } = useDraggablePanel({ left: 16, top: 80 });
  const [collapsed, setCollapsed] = useState(false);

  if (!open) return null;

  return (
    <div className="debug-panel" style={{ ...panelStyle, left: pos.left, top: pos.top }}>
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
        <GlobeLookControls />

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
