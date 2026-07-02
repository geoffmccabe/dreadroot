// Small reusable control rows for the panel-theme (CSS) editor. Colors are stored
// as HSL {h,s,l}; the native color <input> speaks hex, so we convert both ways.
import type { ReactNode } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { Hsl } from '@/theme/panelTheme';

// ── HSL <-> hex ──────────────────────────────────────────────────────────────
export function hslToHex({ h, s, l }: Hsl): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToHsl(hex: string): Hsl {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// ── layout ───────────────────────────────────────────────────────────────────
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-xs opacity-80 min-w-[96px]">{label}</span>
      <div className="flex items-center gap-2 justify-end flex-1">{children}</div>
    </div>
  );
}

export function SliderRow({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <Slider value={[value]} min={min} max={max} step={step}
        onValueChange={([v]) => onChange(v)} className="w-32" />
      <span className="text-xs tabular-nums w-14 text-right">{value}{unit}</span>
    </Row>
  );
}

export function ColorRow({ label, color, onChange }: {
  label: string; color: Hsl; onChange: (c: Hsl) => void;
}) {
  return (
    <Row label={label}>
      <input type="color" value={hslToHex(color)}
        onChange={(e) => onChange(hexToHsl(e.target.value))}
        className="h-6 w-12 rounded cursor-pointer bg-transparent border border-white/20" />
    </Row>
  );
}

export function SwitchRow({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}

export function SelectRow({ label, value, options, onChange }: {
  label: string; value: string; options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="text-xs rounded px-2 py-1 bg-black/20 border border-white/20 max-w-[150px]">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Row>
  );
}
