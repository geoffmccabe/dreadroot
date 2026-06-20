// TerrainBrushPanel — styled (game CSS) terrain-builder panel, rendered OUTSIDE the
// Canvas like SiegeTeleportMenu. Shows only on editable (heightmap) siege maps. Toggles
// build mode and sets mode/size/strength/blur; the in-Canvas TerrainBrushController does
// the actual sculpting. Hold B to apply at the crosshair.
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useActiveGame } from '@/config/activeGame';
import { useActiveMapId } from '@/config/activeMap';
import { getWorldDefinition } from '@/config/worldDefinition';
import { useBrushState, setBrushState } from './terrainBrushState';
import type { BrushMode } from './heightField';

const MODES: { key: BrushMode; label: string }[] = [
  { key: 'raise', label: 'Raise (R)' },
  { key: 'lower', label: 'Lower (F)' },
  { key: 'smooth', label: 'Smooth (G)' },
  { key: 'flat', label: 'Flatten (T)' },
];

export function TerrainBrushPanel() {
  const game = useActiveGame();
  const mapId = useActiveMapId();
  const bs = useBrushState();
  const world = getWorldDefinition(mapId);
  if (game !== 'siege-worlds' || world.ground.kind !== 'heightmap') return null;

  return (
    <Card className="waterfall-card fixed left-4 top-1/2 -translate-y-1/2 z-50 w-56 p-3 text-xs font-mono">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-primary">⛰ Terrain</span>
        <Button
          size="sm"
          variant={bs.enabled ? 'default' : 'outline'}
          className="h-6 px-2 text-[10px]"
          onClick={() => setBrushState({ enabled: !bs.enabled })}
        >
          {bs.enabled ? 'BUILD ON' : 'build off'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-1">
        {MODES.map((m) => (
          <Button
            key={m.key}
            size="sm"
            variant={bs.mode === m.key ? 'default' : 'outline'}
            className="h-7 px-1 text-[10px]"
            onClick={() => setBrushState({ mode: m.key })}
          >
            {m.label}
          </Button>
        ))}
      </div>

      <div className="mt-3 space-y-2 text-muted-foreground">
        <div>
          <div className="mb-1 flex justify-between"><span>Size</span><b className="text-foreground">{bs.radius} m</b></div>
          <Slider value={[bs.radius]} min={2} max={80} step={1} onValueChange={([v]) => setBrushState({ radius: v })} />
        </div>
        <div>
          <div className="mb-1 flex justify-between"><span>Strength</span><b className="text-foreground">{bs.strength}</b></div>
          <Slider value={[bs.strength]} min={1} max={40} step={1} onValueChange={([v]) => setBrushState({ strength: v })} />
        </div>
        <div>
          <div className="mb-1 flex justify-between"><span>Edge blur</span><b className="text-foreground">{Math.round(bs.edge * 100)}%</b></div>
          <Slider value={[bs.edge]} min={0} max={1} step={0.05} onValueChange={([v]) => setBrushState({ edge: v })} />
        </div>
      </div>

      <div className="mt-2 text-[10px] text-muted-foreground">
        {bs.enabled ? 'Look at ground · hold B to sculpt' : 'Turn ON to sculpt the terrain'}
      </div>
    </Card>
  );
}
