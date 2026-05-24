import React, { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trophy, Skull } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Metric =
  | 'shots_hit'
  | 'damage_dealt'
  | 'total_kills'
  | 'fruits_collected'
  | 'distance_traveled_blocks';

interface LeaderboardRow {
  rank: number;
  user_id: string;
  display_name: string;
  value: number;
}

const METRICS: { id: Metric; label: string; unit?: string; format: (v: number) => string }[] = [
  { id: 'total_kills',              label: 'Total Kills',       format: (v) => new Intl.NumberFormat().format(v) },
  { id: 'shots_hit',                label: 'Shots Hit',         format: (v) => new Intl.NumberFormat().format(v) },
  { id: 'damage_dealt',             label: 'Damage Dealt',      format: (v) => new Intl.NumberFormat().format(Math.round(v)) },
  { id: 'fruits_collected',         label: 'Fruits Collected',  format: (v) => new Intl.NumberFormat().format(v) },
  { id: 'distance_traveled_blocks', label: 'Distance Traveled', format: (v) => `${new Intl.NumberFormat().format(Math.round(v))} blocks` },
];

function LeaderboardTab({ metric, format }: { metric: Metric; format: (v: number) => string }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    (async () => {
      const { data: userResp } = await supabase.auth.getUser();
      setMyUserId(userResp.user?.id ?? null);

      const { data, error: rpcErr } = await supabase.rpc('get_leaderboard' as any, {
        p_metric: metric,
        p_limit: 100,
      });
      if (rpcErr) {
        console.error('[Leaderboard]', metric, rpcErr);
        setError(rpcErr.message);
        setRows([]);
      } else {
        setRows((data ?? []) as LeaderboardRow[]);
      }
      setLoading(false);
    })();
  }, [metric]);

  if (loading) {
    return <div className="text-sm text-muted-foreground p-4">Loading leaderboard…</div>;
  }
  if (error) {
    return <div className="text-sm text-destructive p-4">Couldn't load: {error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-6 text-center">
        No data yet — be the first to land on this leaderboard.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[480px]">
      <div className="space-y-1 pr-2">
        {rows.map(row => {
          const isMe = myUserId && row.user_id === myUserId;
          return (
            <div
              key={row.user_id}
              className={`flex items-center gap-3 py-2 px-3 rounded-md ${isMe ? 'bg-primary/20 ring-1 ring-primary/50' : 'hover:bg-muted/30'}`}
            >
              <div className={`w-8 text-right font-mono text-sm ${row.rank <= 3 ? 'font-bold' : ''}`}>
                {row.rank === 1 && <Trophy className="inline h-3.5 w-3.5 mr-0.5 text-yellow-400" />}
                {row.rank === 2 && <Trophy className="inline h-3.5 w-3.5 mr-0.5 text-gray-300" />}
                {row.rank === 3 && <Trophy className="inline h-3.5 w-3.5 mr-0.5 text-amber-600" />}
                {row.rank}
              </div>
              <div className="flex-1 min-w-0 truncate text-sm">
                {row.display_name}
                {isMe && <Badge variant="secondary" className="ml-2 text-[10px]">You</Badge>}
              </div>
              <div className="font-mono text-sm tabular-nums">{format(row.value)}</div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------
// Kills by monster + tier — top-20 each.
// ---------------------------------------------------------------------
const MONSTERS: { id: string; label: string }[] = [
  { id: 'shombie',   label: 'Shombie' },
  { id: 'shnake',    label: 'Shnake' },
  { id: 'walapa',    label: 'Walapa' },
  { id: 'shtickman', label: 'Shtickman' },
  { id: 'shwarm',    label: 'Shwarm' },
  { id: 'shpider',   label: 'Shpider' },
];
const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

interface KillRow { rank: number; user_id: string; display_name: string; kills: number; }

function KillLeaderboard({ enemyType, tier }: { enemyType: string; tier: number }) {
  const [rows, setRows] = useState<KillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    (async () => {
      const { data: userResp } = await supabase.auth.getUser();
      setMyUserId(userResp.user?.id ?? null);

      const { data, error: rpcErr } = await supabase.rpc('get_kill_leaderboard' as any, {
        p_enemy_type: enemyType,
        p_tier: tier,
        p_limit: 20,
      });
      if (rpcErr) {
        setError(rpcErr.message);
        setRows([]);
      } else {
        setRows((data ?? []) as KillRow[]);
      }
      setLoading(false);
    })();
  }, [enemyType, tier]);

  if (loading) return <div className="text-sm text-muted-foreground p-4">Loading…</div>;
  if (error)   return <div className="text-sm text-destructive p-4">Couldn't load: {error}</div>;
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-6 text-center">
        No kills recorded yet for this tier.
      </div>
    );
  }

  return (
    <div className="space-y-1 pr-2">
      {rows.map(row => {
        const isMe = myUserId && row.user_id === myUserId;
        return (
          <div
            key={row.user_id}
            className={`flex items-center gap-3 py-2 px-3 rounded-md ${isMe ? 'bg-primary/20 ring-1 ring-primary/50' : 'hover:bg-muted/30'}`}
          >
            <div className={`w-8 text-right font-mono text-sm ${row.rank <= 3 ? 'font-bold' : ''}`}>
              {row.rank === 1 && <Trophy className="inline h-3.5 w-3.5 mr-0.5 text-yellow-400" />}
              {row.rank === 2 && <Trophy className="inline h-3.5 w-3.5 mr-0.5 text-gray-300" />}
              {row.rank === 3 && <Trophy className="inline h-3.5 w-3.5 mr-0.5 text-amber-600" />}
              {row.rank}
            </div>
            <div className="flex-1 min-w-0 truncate text-sm">
              {row.display_name}
              {isMe && <Badge variant="secondary" className="ml-2 text-[10px]">You</Badge>}
            </div>
            <div className="font-mono text-sm tabular-nums">
              {new Intl.NumberFormat().format(row.kills)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KillsByMonster() {
  const [monster, setMonster] = useState<string>(MONSTERS[0].id);
  const [tier, setTier]       = useState<number>(1);
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Skull className="h-5 w-5" />
        <h3 className="font-semibold">Kills by Monster — Top 20</h3>
      </div>

      {/* Monster pills */}
      <div className="flex flex-wrap gap-1 mb-2">
        {MONSTERS.map(m => (
          <Button
            key={m.id}
            size="sm"
            variant={monster === m.id ? 'default' : 'outline'}
            onClick={() => setMonster(m.id)}
            className="text-xs"
          >
            {m.label}
          </Button>
        ))}
      </div>

      {/* Tier pills */}
      <div className="flex flex-wrap gap-1 mb-3">
        {TIERS.map(t => (
          <Button
            key={t}
            size="sm"
            variant={tier === t ? 'default' : 'outline'}
            onClick={() => setTier(t)}
            className="text-xs w-9 px-0"
          >
            T{t}
          </Button>
        ))}
      </div>

      <ScrollArea className="h-[360px]">
        <KillLeaderboard enemyType={monster} tier={tier} />
      </ScrollArea>
    </Card>
  );
}

export function LeaderboardsPanel() {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="h-5 w-5" />
          <h3 className="font-semibold">Leaderboards — Top 100</h3>
        </div>
        <Tabs defaultValue={METRICS[0].id} className="flex flex-col">
          <TabsList className="grid w-full grid-cols-5">
            {METRICS.map(m => (
              <TabsTrigger key={m.id} value={m.id} className="text-xs">
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {METRICS.map(m => (
            <TabsContent key={m.id} value={m.id} className="mt-3">
              <LeaderboardTab metric={m.id} format={m.format} />
            </TabsContent>
          ))}
        </Tabs>
      </Card>

      <KillsByMonster />
    </div>
  );
}
