import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { WeatherControlsProps } from './adminPanel.types';

export function WeatherControls({ settings, onSettingsChange }: WeatherControlsProps) {
  return (
    <Card className="w-full p-6">
      <h3 className="font-bold text-sm mb-4">DAY/NIGHT CYCLE</h3>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Day/Night Range</Label>
            <span className="text-sm font-mono opacity-75">
              {settings.lightingRange[0]}% (Day) - {settings.lightingRange[1]}% (Night)
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
            <span>0% = Pure Day (Bright Blue, No Stars)</span>
            <span>100% = Pure Night (Black, Full Stars)</span>
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
            Sky transitions from bright blue with no stars (low %) to pure black with bright stars (high %).
          </p>
        </div>
      </div>
    </Card>
  );
}
