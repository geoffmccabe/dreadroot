// SwCharactersPanel — Admin → "Characters" (first tab, before Coins). One card per playable
// character (alphabetical), styled like Enemies SW but with a 2.5× hex + model. Right side (narrower
// because the hex is bigger) holds Special Abilities, then Character Stats. Stats default to 100 and
// are editable; they persist locally and will later drive in-game modifiers.
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  CHARACTERS, CHAR_STAT_FIELDS, useCharacterData, getCharData,
  setCharStat, setCharAbilities, resetChar, type CharacterDef,
} from './characterStats';
import { CharHexThumb } from './CharacterPreview';
import { MonsterPortCanvas } from '../challenge/MonsterPreview';

function AbilitiesEditor({ name, abilities }: { name: string; abilities: string[] }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-primary/90 font-semibold">Special Abilities</span>
      <div className="space-y-1 mt-1">
        {abilities.length === 0 && (
          <span className="text-[11px] text-muted-foreground italic">No abilities yet — add one or more.</span>
        )}
        {abilities.map((ab, i) => (
          <div key={`${name}-ab-${i}`} className="flex gap-1">
            <Input
              key={`${name}-ab-${i}-${ab}`}
              defaultValue={ab}
              placeholder="Ability (e.g. Double Jump, Cloak…)"
              onBlur={(e) => { const next = [...abilities]; next[i] = e.target.value; setCharAbilities(name, next); }}
              className="h-7 text-xs"
            />
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs shrink-0"
              onClick={() => setCharAbilities(name, abilities.filter((_, j) => j !== i))}>×</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="h-7 text-xs"
          onClick={() => setCharAbilities(name, [...abilities, ''])}>+ Add ability</Button>
      </div>
    </div>
  );
}

function CharacterCard({ def }: { def: CharacterDef }) {
  useCharacterData();                       // re-render on any stat/ability change
  const data = getCharData(def.name);
  return (
    <Card>
      <div className="flex items-stretch gap-2">
        <div className="flex items-center justify-center pl-3 pr-1 shrink-0">
          <CharHexThumb file={def.file} rawH={def.rawH} size={220} />
        </div>
        <div className="flex-1 min-w-0">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold">{def.name}</span>
              <Button variant="outline" size="sm" className="h-7 ml-auto text-xs"
                onClick={() => resetChar(def.name)}>Reset to defaults</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <AbilitiesEditor name={def.name} abilities={data.abilities} />
            <div>
              <span className="text-[10px] uppercase tracking-wide text-primary/90 font-semibold">Character Stats</span>
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 mt-1">
                {CHAR_STAT_FIELDS.map((f) => (
                  <div key={f.key} className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">{f.label}</span>
                    <Input
                      type="number"
                      key={`${def.name}-${f.key}-${data.stats[f.key]}`}
                      defaultValue={data.stats[f.key]}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value.trim() !== '' && !Number.isNaN(v)) setCharStat(def.name, f.key, v);
                      }}
                      className="h-7 text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}

export function SwCharactersPanel() {
  return (
    <div className="space-y-4">
      {/* Shared WebGL canvas behind every hex thumb. */}
      <MonsterPortCanvas />
      {CHARACTERS.map((c) => <CharacterCard key={c.name} def={c} />)}
      <p className="text-xs text-muted-foreground pt-1">
        Stats default to 100 and save in your browser. They'll later drive in-game modifiers (making
        each character better or worse at each thing). Special abilities are freeform for now and will
        be wired to gameplay effects later.
      </p>
    </div>
  );
}
