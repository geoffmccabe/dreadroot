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
import { useState } from 'react';
import { useBrushState, setBrushState } from './terrainBrushState';
import { serializeField, type BrushMode } from './heightField';
import { saveMap } from './mapPersistence';

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
  const [saved, setSaved] = useState(false);
  if (game !== 'siege-worlds' || world.ground.kind !== 'heightmap') return null;

  const onSave = async () => {
    await saveMap({
      id: world.id,
      name: world.name,
      heightField: serializeField(),
      water: { on: bs.waterOn, level: bs.waterLevel },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

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
          <div className="mb-1 flex justify-between"><span>Size <span className="opacity-60">(scroll)</span></span><b className="text-foreground">{bs.radius} m</b></div>
          <Slider value={[bs.radius]} min={0.5} max={80} step={0.5} onValueChange={([v]) => setBrushState({ radius: v })} />
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
        {bs.enabled ? 'Look at ground · hold LEFT-MOUSE to sculpt · scroll = size' : 'Turn ON to sculpt the terrain'}
      </div>

      <div className="mt-3 border-t border-border/40 pt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-bold text-primary">💧 Water</span>
          <Button
            size="sm"
            variant={bs.waterOn ? 'default' : 'outline'}
            className="h-6 px-2 text-[10px]"
            onClick={() => setBrushState({ waterOn: !bs.waterOn })}
          >
            {bs.waterOn ? 'ON' : 'off'}
          </Button>
        </div>
        {bs.waterOn && (
          <div className="text-muted-foreground">
            <div className="mb-1 flex justify-between"><span>Level</span><b className="text-foreground">{bs.waterLevel} m</b></div>
            <Slider value={[bs.waterLevel]} min={-40} max={120} step={1} onValueChange={([v]) => setBrushState({ waterLevel: v })} />
            <div className="mt-1 text-[10px]">Lower terrain below this to make lakes.</div>
          </div>
        )}
      </div>

      <Button size="sm" className="mt-3 h-7 w-full text-[11px]" onClick={onSave}>
        {saved ? 'Saved ✓' : 'Save map'}
      </Button>
    </Card>
  );
}
