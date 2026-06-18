// SwEnemiesPanel — Admin → NPC → "Enemies SW". Lists every Siege Worlds monster as a card
// (stats read from the gameplay catalog), sorted alphabetically by an editable name. Edit a
// name and the list re-sorts live. Kept separate from the EMS "Enemies" panel by design.
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useSwMonsters, setSwMonsterName } from './siegeMonsterRegistry';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function SwEnemiesPanel() {
  const monsters = useSwMonsters();
  return (
    <div className="space-y-4">
      {monsters.map((m) => (
        <Card key={m.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3 flex-wrap">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={m.name}
                onChange={(e) => setSwMonsterName(m.id, e.target.value)}
                className="max-w-[220px] font-semibold"
              />
              {m.special && <Badge variant="outline">{m.special}</Badge>}
            </div>
          </CardHeader>
          <CardContent className="text-sm grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1">
            <Stat label="Model" value={m.model} />
            <Stat label="Health" value={m.health} />
            <Stat label="Damage" value={m.dmgMin != null ? `${m.dmgMin}–${m.dmgMax}` : '—'} />
            <Stat label="Attack range" value={m.attackRange != null ? `${m.attackRange} m` : '—'} />
            <Stat label="Attack every" value={m.attackMs != null ? `${m.attackMs} ms` : '—'} />
            <Stat label="Speed" value={`${m.speed} m/s`} />
            <Stat label="Gait" value={m.gait} />
            <Stat label="npcType" value={m.id} />
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground pt-1">
        Stats are read from the Siege Worlds monster catalog. Names are editable here and the list
        auto-sorts alphabetically. Full stat editing (incl. strike chance / hit chance / range×height)
        lands with the unified monster registry.
      </p>
    </div>
  );
}
