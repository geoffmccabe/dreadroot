import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { ViewSettings, DistantChunkRingSettings } from '@/components/fortress/FortressTypes';
import { DEFAULT_VIEW_SETTINGS } from '@/components/fortress/FortressTypes';

interface ViewSettingsPanelProps {
  viewSettings: ViewSettings;
  onUpdate: (settings: ViewSettings) => void;
}

function RingControl({
  label,
  description,
  ring,
  onChange,
}: {
  label: string;
  description: string;
  ring: DistantChunkRingSettings;
  onChange: (updated: DistantChunkRingSettings) => void;
}) {
  return (
    <div className="space-y-3 border rounded p-4">
      <div>
        <h4 className="font-bold text-sm">{label}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Opacity</Label>
          <span className="text-xs font-mono opacity-75">{ring.opacity.toFixed(2)}</span>
        </div>
        <Slider
          value={[ring.opacity]}
          onValueChange={([v]) => onChange({ ...ring, opacity: v })}
          min={0} max={1} step={0.01}
          className="w-full"
        />
        <p className="text-[10px] text-muted-foreground">
          Base opacity before fog is applied. Fog further fades blocks at distance.
        </p>
      </div>
    </div>
  );
}

export function ViewSettingsPanel({ viewSettings, onUpdate }: ViewSettingsPanelProps) {
  const vs = viewSettings ?? DEFAULT_VIEW_SETTINGS;

  // All updates go directly to parent — parent handles DB debouncing
  const set = (patch: Partial<ViewSettings>) => {
    onUpdate({ ...vs, ...patch });
  };

  return (
    <Card className="w-full p-6">
      <h3 className="font-bold text-sm mb-2">DISTANT CHUNK RENDERING</h3>
      <p className="text-xs text-muted-foreground mb-6">
        3 rings of silhouette blocks beyond the visual distance. Scene fog handles
        distance blending — use the Lightning Panel to adjust fog range and colors.
      </p>

      <div className="space-y-6">
        {/* Global settings */}
        <div className="space-y-4">
          <h4 className="font-bold text-xs uppercase text-muted-foreground">Global Settings</h4>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Base Silhouette Color</Label>
              <input
                type="color"
                value={vs.baseColor}
                onChange={(e) => set({ baseColor: e.target.value })}
                className="w-8 h-6 rounded border cursor-pointer"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Base color of distant chunk silhouettes before fog is applied.
            </p>
          </div>
        </div>

        {/* Rendering info */}
        <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded space-y-1">
          <p className="font-bold text-foreground/70">How It Works</p>
          <p>Material: MeshBasicMaterial (unlit, no shadows)</p>
          <p>Fog: true — scene fog blends chunks toward fog color at distance</p>
          <p>Fog range covers full draw distance (normal + fade chunks)</p>
          <p>depthWrite: false, transparent: true</p>
          <p className="pt-1 italic">Fog start/end %, day/night colors: Lightning Panel</p>
        </div>

        {/* Per-ring controls */}
        <h4 className="font-bold text-xs uppercase text-muted-foreground">Per-Ring Settings</h4>

        <RingControl
          label="Distant Chunks 1 (closest)"
          description="First ring beyond visual distance. Most visible."
          ring={vs.ring1}
          onChange={(r) => set({ ring1: r })}
        />

        <RingControl
          label="Distant Chunks 2 (middle)"
          description="Second ring. Moderate opacity, more fogged."
          ring={vs.ring2}
          onChange={(r) => set({ ring2: r })}
        />

        <RingControl
          label="Distant Chunks 3 (farthest)"
          description="Outermost ring at the horizon. Heavily fogged."
          ring={vs.ring3}
          onChange={(r) => set({ ring3: r })}
        />
      </div>
    </Card>
  );
}
