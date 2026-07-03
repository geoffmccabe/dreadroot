// TerrainPGPanel — the Procedural-Generation body of the Terrain panel (shown when the
// Terrain build mode is 'PG'). Renders the stack of PG layers; only Layer 0 (surface
// textures) is functional so far. Layer 0 lets you view / rename / remove / add the
// terrain surface textures the biome painter will draw from. Styled with the game CSS,
// rendered outside the Canvas like the rest of the panel.
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  usePGState, setPGState, PG_LAYERS,
  addSurfaceFromFile, removeSurface, renameSurface,
} from './pgState';

export function TerrainPGPanel() {
  const pg = usePGState();
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) for (const f of Array.from(files)) addSurfaceFromFile(f);
    e.target.value = '';
  };

  return (
    <div className="mt-2 space-y-1">
      {PG_LAYERS.map((layer) => {
        const open = pg.openLayer === layer.id;
        return (
          <div key={layer.id}>
            <button
              disabled={!layer.ready}
              onClick={() => setPGState({ openLayer: open ? null : layer.id })}
              className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-[10px] ${
                layer.ready
                  ? `cursor-pointer hover:border-primary ${open ? 'border-primary text-primary' : 'border-border/50 text-foreground'}`
                  : 'cursor-default border-border/30 text-muted-foreground/60'
              }`}
            >
              <span>{layer.label}</span>
              {layer.ready ? <span>{open ? '▾' : '▸'}</span> : <span className="text-[9px] italic">soon</span>}
            </button>

            {layer.ready && open && layer.kind === 'surface' && (
              <div className="mt-1 rounded border border-border/40 p-2">
                <div className="mb-1 text-[10px] text-muted-foreground">
                  Ground textures the biome painter blends. First three are live.
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {pg.surfaces.map((s) => (
                    <div key={s.id} className="group relative rounded border border-border/40 p-1">
                      <img src={s.url} alt={s.name} className="h-10 w-full rounded object-cover" />
                      <input
                        value={s.name}
                        onChange={(e) => renameSurface(s.id, e.target.value)}
                        className="mt-0.5 w-full bg-transparent text-center text-[9px] text-foreground outline-none"
                      />
                      {!s.builtin && (
                        <button
                          onClick={() => removeSurface(s.id)}
                          title="Remove"
                          className="absolute right-0.5 top-0.5 hidden h-4 w-4 rounded bg-background/80 text-[10px] leading-none text-destructive group-hover:block"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick} />
                <Button size="sm" className="mt-2 h-7 w-full text-[10px]" onClick={() => fileRef.current?.click()}>
                  + Add surface texture
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
