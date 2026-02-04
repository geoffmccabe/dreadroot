import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type BorderStyle = 'none' | 'basic' | 'inner-glow' | 'pulse-glow' | 'moving-lines' | 'electric';
type BorderVariant = 'rainbow' | 'fire' | 'cosmic' | undefined;

interface RarityTier {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  thirdColor: string;
  backgroundColor: string;
  backgroundOpacity: number; // 0-100
  borderStyle: BorderStyle;
  borderColor: string;
  variant?: BorderVariant;
}

// Helper: convert hex + opacity (0-100) to rgba string
function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

// ─── Default Tiers ───────────────────────────────────────────────────────────

const DEFAULT_TIERS: RarityTier[] = [
  { name: 'Common',      primaryColor: '#FFD700', secondaryColor: '#B8960F', thirdColor: '#8B7200', backgroundColor: '#FFD700', backgroundOpacity: 50, borderStyle: 'none',         borderColor: '#FFD700' },
  { name: 'Uncommon',    primaryColor: '#22C55E', secondaryColor: '#16A34A', thirdColor: '#0D7A36', backgroundColor: '#22C55E', backgroundOpacity: 50, borderStyle: 'basic',        borderColor: '#22C55E' },
  { name: 'Rare',        primaryColor: '#3B82F6', secondaryColor: '#2563EB', thirdColor: '#1D4ED8', backgroundColor: '#3B82F6', backgroundOpacity: 50, borderStyle: 'inner-glow',   borderColor: '#3B82F6' },
  { name: 'Epic',        primaryColor: '#A855F7', secondaryColor: '#9333EA', thirdColor: '#7E22CE', backgroundColor: '#A855F7', backgroundOpacity: 50, borderStyle: 'inner-glow',   borderColor: '#A855F7' },
  { name: 'Legendary',   primaryColor: '#EF4444', secondaryColor: '#DC2626', thirdColor: '#B91C1C', backgroundColor: '#EF4444', backgroundOpacity: 50, borderStyle: 'pulse-glow',   borderColor: '#EF4444' },
  { name: 'Divine',      primaryColor: '#C0C0C0', secondaryColor: '#A0A0A0', thirdColor: '#808080', backgroundColor: '#C0C0C0', backgroundOpacity: 50, borderStyle: 'moving-lines', borderColor: '#C0C0C0' },
  { name: 'Mystic',      primaryColor: '#FF69B4', secondaryColor: '#EC4899', thirdColor: '#DB2777', backgroundColor: '#FF69B4', backgroundOpacity: 50, borderStyle: 'moving-lines', borderColor: '#FF69B4' },
  { name: 'Rainbow',     primaryColor: '#FF0000', secondaryColor: '#00FF00', thirdColor: '#0000FF', backgroundColor: '#FF0000', backgroundOpacity: 50, borderStyle: 'inner-glow',   borderColor: '#FF0000', variant: 'rainbow' },
  { name: 'Apocalyptic', primaryColor: '#FF4500', secondaryColor: '#FF8C00', thirdColor: '#FF2200', backgroundColor: '#FF4500', backgroundOpacity: 50, borderStyle: 'electric',     borderColor: '#FF4500', variant: 'fire' },
  { name: 'Cosmic',      primaryColor: '#D4AF37', secondaryColor: '#FFFFFF', thirdColor: '#FFD700', backgroundColor: '#D4AF37', backgroundOpacity: 50, borderStyle: 'electric',     borderColor: '#D4AF37', variant: 'cosmic' },
];

// ─── SVG Filters (rendered once, hidden) ─────────────────────────────────────

function ElectricSVGFilters() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
      <defs>
        <filter id="electric-turbulence" colorInterpolationFilters="sRGB" x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence type="turbulence" baseFrequency="0.04" numOctaves={3} result="noise" seed={1}>
            <animate attributeName="baseFrequency" values="0.04;0.055;0.035;0.06;0.04;0.05;0.03;0.055;0.045;0.035" dur="1s" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={5} xChannelSelector="R" yChannelSelector="B" />
        </filter>
        <filter id="electric-turbulence-medium" colorInterpolationFilters="sRGB" x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence type="turbulence" baseFrequency="0.05" numOctaves={3} result="noise" seed={3}>
            <animate attributeName="baseFrequency" values="0.045;0.065;0.04;0.06;0.05;0.07;0.04;0.065;0.055;0.045" dur="0.9s" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={8} xChannelSelector="R" yChannelSelector="B" />
        </filter>
        <filter id="electric-turbulence-heavy" colorInterpolationFilters="sRGB" x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence type="turbulence" baseFrequency="0.06" numOctaves={4} result="noise" seed={2}>
            <animate attributeName="baseFrequency" values="0.05;0.08;0.04;0.07;0.06;0.09;0.05;0.08;0.06;0.07" dur="0.8s" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={12} xChannelSelector="R" yChannelSelector="B" />
        </filter>
      </defs>
    </svg>
  );
}

// ─── Border Wrapper ──────────────────────────────────────────────────────────

function RarityBorderWrapper({
  borderStyle,
  borderColor,
  variant,
  children,
}: {
  borderStyle: BorderStyle;
  borderColor: string;
  variant?: BorderVariant;
  children: React.ReactNode;
}) {
  if (borderStyle === 'none') {
    return <div className="rounded-lg">{children}</div>;
  }

  if (borderStyle === 'basic') {
    return (
      <div className="perc-border perc-border-static" style={{ '--border-color': borderColor } as React.CSSProperties}>
        <div className="perc-border-outer">
          <div className="perc-border-middle">
            <div className="perc-border-inner-static">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (borderStyle === 'inner-glow') {
    return (
      <div
        className={cn('perc-border-inner-glow', variant === 'rainbow' && 'inner-glow-rainbow')}
        style={{ '--glow-color': borderColor } as React.CSSProperties}
      >
        <div className="inner-glow-border" />
        <div className="inner-glow-content">
          {children}
        </div>
      </div>
    );
  }

  if (borderStyle === 'pulse-glow') {
    return (
      <div className="perc-border-pulse-glow" style={{ '--glow-color': borderColor } as React.CSSProperties}>
        <div className="pulse-glow-inner">
          <div className="pulse-glow-content">
            {children}
          </div>
        </div>
      </div>
    );
  }

  if (borderStyle === 'moving-lines') {
    return (
      <div className="perc-border-moving-lines" style={{ '--line-color': borderColor } as React.CSSProperties}>
        <div className="moving-lines-container">
          <div className="moving-lines-border" />
          <div className="moving-lines-mask" />
        </div>
        <div className="moving-lines-content">
          {children}
        </div>
      </div>
    );
  }

  if (borderStyle === 'electric') {
    return (
      <div
        className={cn(
          'perc-border-electric',
          variant === 'fire' && 'electric-fire',
          variant === 'cosmic' && 'electric-cosmic'
        )}
        style={{ '--electric-color': borderColor } as React.CSSProperties}
      >
        <div className="electric-inner">
          <div className="electric-glow-2" />
          <div className="electric-glow-1" />
          <div className="electric-border-line" />
          <div className="electric-content">
            {children}
          </div>
        </div>
      </div>
    );
  }

  return <div>{children}</div>;
}

// ─── Color Picker Field ──────────────────────────────────────────────────────

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground w-20 shrink-0">{label}</Label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded border border-border cursor-pointer bg-transparent p-0"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-24 text-xs font-mono"
      />
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function RarityTiersPanel() {
  const [tiers, setTiers] = useState<RarityTier[]>(DEFAULT_TIERS);
  const [selectedTier, setSelectedTier] = useState<number>(0);

  const updateTier = (index: number, updates: Partial<RarityTier>) => {
    setTiers(prev => prev.map((t, i) => i === index ? { ...t, ...updates } : t));
  };

  const selected = tiers[selectedTier];

  return (
    <div className="space-y-4">
      <ElectricSVGFilters />

      <h3 className="text-lg font-semibold">Rarity Tiers</h3>

      {/* 2-column grid, reading order: left-right then down */}
      <div className="grid grid-cols-2 gap-4">
        {tiers.map((tier, tierIndex) => (
          <div
            key={tierIndex}
            className={cn(
              'cursor-pointer transition-opacity',
              selectedTier === tierIndex ? 'opacity-100 ring-2 ring-white/30 rounded-lg' : 'opacity-80 hover:opacity-100'
            )}
            onClick={() => setSelectedTier(tierIndex)}
          >
            {/* Fixed-height container isolates each tier's border effects */}
            <div className="h-[100px] relative">
              <RarityBorderWrapper
                borderStyle={tier.borderStyle}
                borderColor={tier.borderColor}
                variant={tier.variant}
              >
                <div
                  className="flex items-center justify-center h-[80px] rounded-lg"
                  style={{ backgroundColor: hexToRgba(tier.backgroundColor, tier.backgroundOpacity) }}
                >
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground">Tier {tierIndex + 1}</div>
                    <div className="text-sm font-semibold text-white">
                      {tier.name}
                    </div>
                  </div>
                </div>
              </RarityBorderWrapper>
            </div>
          </div>
        ))}
      </div>

      {/* Editor for selected tier */}
      <Card className="border-2 transition-colors" style={{ borderColor: selected.primaryColor }}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs text-muted-foreground">Tier {selectedTier + 1}</span>
            <span className="text-sm font-semibold" style={{ color: selected.primaryColor }}>{selected.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">Border: {selected.borderStyle}{selected.variant ? ` (${selected.variant})` : ''}</span>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-20 shrink-0">Name</Label>
            <Input
              value={selected.name}
              onChange={(e) => updateTier(selectedTier, { name: e.target.value })}
              className="h-8 text-sm"
            />
          </div>

          <div className="flex gap-4">
            <ColorField label="Primary" value={selected.primaryColor} onChange={(v) => updateTier(selectedTier, { primaryColor: v })} />
            <ColorField label="Secondary" value={selected.secondaryColor} onChange={(v) => updateTier(selectedTier, { secondaryColor: v })} />
            <ColorField label="Third" value={selected.thirdColor} onChange={(v) => updateTier(selectedTier, { thirdColor: v })} />
          </div>

          <div className="flex gap-4">
            <ColorField label="Background" value={selected.backgroundColor} onChange={(v) => updateTier(selectedTier, { backgroundColor: v })} />
            <ColorField label="Border" value={selected.borderColor} onChange={(v) => updateTier(selectedTier, { borderColor: v })} />
          </div>

          {/* Background opacity slider */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-20 shrink-0">BG Opacity</Label>
            <Slider
              value={[selected.backgroundOpacity]}
              min={0}
              max={100}
              step={1}
              className="flex-1"
              onValueChange={([v]) => updateTier(selectedTier, { backgroundOpacity: v })}
            />
            <span className="text-xs text-muted-foreground w-10 text-right">{selected.backgroundOpacity}%</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
