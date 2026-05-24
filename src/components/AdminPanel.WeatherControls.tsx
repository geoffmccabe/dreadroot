import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { WeatherControlsProps } from './adminPanel.types';
import type { CloudLayerSettings } from '@/components/fortress/FortressTypes';

const DEFAULT_CLOUD: CloudLayerSettings = { enabled: false, opacity: 0.45, coverage: 0.5, height: 300, speed: 5, direction: 45, scale: 2.0, color: '#ffffff' };

const DIRECTION_LABELS: Record<number, string> = {
  0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW', 360: 'N',
};

function getDirectionLabel(deg: number): string {
  // Snap to nearest 45° label
  const normalized = ((deg % 360) + 360) % 360;
  const nearest = Math.round(normalized / 45) * 45;
  return DIRECTION_LABELS[nearest] || `${Math.round(normalized)}°`;
}

function CloudLayerControl({
  label,
  layer,
  onChange,
}: {
  label: string;
  layer: CloudLayerSettings;
  onChange: (updated: CloudLayerSettings) => void;
}) {
  const set = <K extends keyof CloudLayerSettings>(key: K, value: CloudLayerSettings[K]) =>
    onChange({ ...layer, [key]: value });

  return (
    <div className="space-y-4 border rounded p-4">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-sm">{label}</h4>
        <Switch checked={layer.enabled} onCheckedChange={(v) => set('enabled', v)} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Opacity</Label>
          <span className="text-xs font-mono opacity-75">{layer.opacity.toFixed(2)}</span>
        </div>
        <Slider value={[layer.opacity]} onValueChange={([v]) => set('opacity', v)} min={0} max={1.0} step={0.01} className="w-full" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Coverage</Label>
          <span className="text-xs font-mono opacity-75">{Math.round(layer.coverage * 100)}%</span>
        </div>
        <Slider value={[layer.coverage]} onValueChange={([v]) => set('coverage', v)} min={0} max={1} step={0.01} className="w-full" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Height</Label>
          <span className="text-xs font-mono opacity-75">{layer.height}m</span>
        </div>
        <Slider value={[layer.height]} onValueChange={([v]) => set('height', v)} min={50} max={800} step={10} className="w-full" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Wind Speed</Label>
          <span className="text-xs font-mono opacity-75">{layer.speed.toFixed(1)}</span>
        </div>
        <Slider value={[layer.speed]} onValueChange={([v]) => set('speed', v)} min={0} max={50} step={0.5} className="w-full" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Wind Direction</Label>
          <span className="text-xs font-mono opacity-75">{Math.round(layer.direction ?? 45)}° {getDirectionLabel(layer.direction ?? 45)}</span>
        </div>
        <Slider value={[layer.direction ?? 45]} onValueChange={([v]) => set('direction', v)} min={0} max={360} step={5} className="w-full" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Scale</Label>
          <span className="text-xs font-mono opacity-75">{layer.scale.toFixed(1)}</span>
        </div>
        <Slider value={[layer.scale]} onValueChange={([v]) => set('scale', v)} min={0.5} max={10} step={0.1} className="w-full" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Color</Label>
          <input
            type="color"
            value={layer.color}
            onChange={(e) => set('color', e.target.value)}
            className="w-8 h-6 rounded border cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}

export function WeatherControls({ settings, onSettingsChange }: WeatherControlsProps) {
  const cloud1 = settings.cloudLayer1 ?? DEFAULT_CLOUD;
  const cloud2 = settings.cloudLayer2 ?? DEFAULT_CLOUD;

  return (
    <Card className="w-full p-6">
      <h3 className="font-bold text-sm mb-4">DAY/NIGHT CYCLE</h3>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Day/Night Range</Label>
            <span className="text-sm font-mono opacity-75">
              {settings.lightingRange[0]}% (Night) - {settings.lightingRange[1]}% (Day)
            </span>
          </div>
          <Slider
            value={settings.lightingRange}
            onValueChange={(value) => onSettingsChange('lightingRange', value as [number, number])}
            min={0}
            max={100}
            step={1}
            minStepsBetweenThumbs={10}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>0% = Pure Night (Black, Full Stars)</span>
            <span>100% = Pure Day (Bright Blue, No Stars)</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Cycle Duration</Label>
            <span className="text-sm font-mono opacity-75">{settings.cycleDuration} min</span>
          </div>
          <Slider
            value={[settings.cycleDuration]}
            onValueChange={([value]) => onSettingsChange('cycleDuration', value)}
            min={1}
            max={60}
            step={1}
            className="w-full"
          />
        </div>

        <div className="text-xs text-muted-foreground mt-4 p-3 bg-muted/50 rounded">
          <p className="mb-1">
            <strong>Current behavior:</strong> Day/night will cycle between {settings.lightingRange[0]}% and {settings.lightingRange[1]}% over {settings.cycleDuration} minutes.
          </p>
          <p>
            Sky transitions from pure black with bright stars (low %) to bright blue with no stars (high %).
          </p>
        </div>
      </div>

      <h3 className="font-bold text-sm mt-8 mb-4">CLOUD LAYERS</h3>
      <div className="space-y-4">
        <CloudLayerControl
          label="Cloud Layer 1"
          layer={cloud1}
          onChange={(updated) => onSettingsChange('cloudLayer1', updated)}
        />
        <CloudLayerControl
          label="Cloud Layer 2"
          layer={cloud2}
          onChange={(updated) => onSettingsChange('cloudLayer2', updated)}
        />
      </div>
    </Card>
  );
}
