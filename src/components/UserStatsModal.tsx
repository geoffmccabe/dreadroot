import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import type { UserData } from './adminPanel.types';

interface UserStatsRow {
  user_id: string;
  shots_fired: number;
  shots_hit: number;
  headshots: number;
  damage_dealt: number;
  damage_taken: number;
  total_kills: number;
  total_deaths: number;
  best_killstreak: number;
  current_killstreak: number;
  best_enemy_tier_killed: number;
  blocks_placed: number;
  trees_planted: number;
  fruits_collected: number;
  fruits_forged: number;
  distance_traveled_blocks: number;
  total_play_seconds: number;
  sessions_count: number;
  distinct_days_played: number;
  first_played_at: string;
  last_played_at: string;
}

interface CombatStatRow {
  enemy_type: string;
  kills: number;
}

interface InventoryItem {
  id: string;
  item_id: string;
  quantity: number;
  item_name?: string;
}

interface UserStatsModalProps {
  user: UserData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}

function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat().format(Math.round(n));
}

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

export function UserStatsModal({ user, open, onOpenChange }: UserStatsModalProps) {
  const [stats, setStats] = useState<UserStatsRow | null>(null);
  const [combatStats, setCombatStats] = useState<CombatStatRow[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Resize state: width × height in px. Drag the bottom-right handle.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 900, h: 640 });
  const resizingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current || !startRef.current) return;
      const dx = ev.clientX - startRef.current.x;
      const dy = ev.clientY - startRef.current.y;
      setSize({
        w: Math.max(600, Math.min(window.innerWidth - 40, startRef.current.w + dx)),
        h: Math.max(420, Math.min(window.innerHeight - 40, startRef.current.h + dy)),
      });
    };
    const onUp = () => {
      resizingRef.current = false;
      startRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [size]);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    setStats(null);
    setCombatStats([]);
    setInventory([]);

    (async () => {
      // user_stats — may not exist for some users yet.
      const { data: statRow } = await (supabase
        .from('user_stats' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle() as any);
      if (statRow) setStats(statRow as UserStatsRow);

      // user_combat_stats — per-enemy-type kills.
      const { data: combatRows } = await supabase
        .from('user_combat_stats')
        .select('enemy_type, kills')
        .eq('user_id', user.id)
        .order('kills', { ascending: false });
      if (combatRows) setCombatStats(combatRows as CombatStatRow[]);

      // user_inventory + items join for names.
      const { data: invRows } = await (supabase
        .from('user_inventory' as any)
        .select('id, item_id, quantity, items(name)')
        .eq('user_id', user.id) as any);
      if (invRows) {
        setInventory((invRows as any[]).map(r => ({
          id: r.id,
          item_id: r.item_id,
          quantity: r.quantity,
          item_name: r.items?.name ?? null,
        })));
      }

      setLoading(false);
    })();
  }, [open, user]);

  if (!user) return null;

  const accuracy = stats && stats.shots_fired > 0
    ? `${((stats.shots_hit / stats.shots_fired) * 100).toFixed(1)}%`
    : '—';
  const kd = stats
    ? (stats.total_deaths === 0 ? stats.total_kills : (stats.total_kills / stats.total_deaths)).toFixed(2)
    : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="admin-panel-dialog overflow-hidden p-0 max-w-none"
        style={{ width: size.w, maxWidth: size.w, height: size.h, maxHeight: size.h }}
      >
        <div className="flex flex-col h-full">
          <DialogHeader className="px-6 pt-4 pb-2 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <span>User Stats</span>
              <Badge variant="secondary" className="font-mono text-xs">{user.email}</Badge>
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden px-6">
            <TabsList className="grid w-full grid-cols-5 flex-shrink-0">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="combat">Combat</TabsTrigger>
              <TabsTrigger value="world">World</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="inventory">Inventory</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 mt-3 pb-4">
              {loading && <p className="text-sm text-muted-foreground p-4">Loading…</p>}

              <TabsContent value="overview" className="space-y-3 mt-0">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="Level" value={fmtNumber(user.profile?.current_level)} />
                  <Stat label="Total points" value={fmtNumber(user.profile?.total_points)} />
                  <Stat label="Coins" value={fmtNumber(user.profile?.coins)} />
                  <Stat label="Health" value={`${fmtNumber(user.profile?.current_health)} / ${fmtNumber(user.profile?.max_health)}`} />
                  <Stat label="Total kills" value={fmtNumber(stats?.total_kills)} />
                  <Stat label="K/D" value={kd} />
                  <Stat label="Accuracy" value={accuracy} />
                  <Stat label="Best killstreak" value={fmtNumber(stats?.best_killstreak)} />
                  <Stat label="Play time" value={fmtDuration(stats?.total_play_seconds)} />
                  <Stat label="Days played" value={fmtNumber(stats?.distinct_days_played)} />
                  <Stat label="Sessions" value={fmtNumber(stats?.sessions_count)} />
                  <Stat label="Last played" value={fmtDate(stats?.last_played_at)} />
                </div>
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Roles</div>
                  <div className="flex gap-1 flex-wrap mt-2">
                    {user.roles.length > 0
                      ? user.roles.map(r => <Badge key={r} variant="secondary">{r}</Badge>)
                      : <Badge variant="outline">user</Badge>}
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="combat" className="space-y-3 mt-0">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="Shots fired" value={fmtNumber(stats?.shots_fired)} />
                  <Stat label="Shots hit" value={fmtNumber(stats?.shots_hit)} />
                  <Stat label="Accuracy" value={accuracy} />
                  <Stat label="Headshots" value={fmtNumber(stats?.headshots)} />
                  <Stat label="Damage dealt" value={fmtNumber(stats?.damage_dealt)} />
                  <Stat label="Damage taken" value={fmtNumber(stats?.damage_taken)} />
                  <Stat label="Total deaths" value={fmtNumber(stats?.total_deaths)} />
                  <Stat label="Best enemy tier killed" value={fmtNumber(stats?.best_enemy_tier_killed)} />
                  <Stat label="K/D" value={kd} />
                  <Stat label="Best killstreak" value={fmtNumber(stats?.best_killstreak)} />
                  <Stat label="Current streak" value={fmtNumber(stats?.current_killstreak)} />
                </div>
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground mb-2">Kills by enemy type</div>
                  {combatStats.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No kills recorded yet.</div>
                  ) : (
                    <div className="space-y-1">
                      {combatStats.map(c => (
                        <div key={c.enemy_type} className="flex justify-between text-sm">
                          <span className="capitalize">{c.enemy_type}</span>
                          <span className="font-mono">{fmtNumber(c.kills)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="world" className="space-y-3 mt-0">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Stat label="Blocks placed" value={fmtNumber(stats?.blocks_placed)} />
                  <Stat label="Trees planted" value={fmtNumber(stats?.trees_planted)} />
                  <Stat label="Fruits collected" value={fmtNumber(stats?.fruits_collected)} />
                  <Stat label="Fruits forged" value={fmtNumber(stats?.fruits_forged)} />
                  <Stat label="Distance traveled" value={`${fmtNumber(stats?.distance_traveled_blocks)} blocks`} />
                </div>
              </TabsContent>

              <TabsContent value="activity" className="space-y-3 mt-0">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Stat label="Total play time" value={fmtDuration(stats?.total_play_seconds)} />
                  <Stat label="Sessions" value={fmtNumber(stats?.sessions_count)} />
                  <Stat label="Distinct days played" value={fmtNumber(stats?.distinct_days_played)} />
                  <Stat label="First played" value={fmtDate(stats?.first_played_at)} />
                  <Stat label="Last played" value={fmtDate(stats?.last_played_at)} />
                  <Stat label="Account created" value={fmtDate(user.created_at)} />
                </div>
              </TabsContent>

              <TabsContent value="inventory" className="space-y-3 mt-0">
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground mb-2">
                    {inventory.length} item{inventory.length === 1 ? '' : 's'}
                  </div>
                  {inventory.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Inventory empty.</div>
                  ) : (
                    <div className="space-y-1">
                      {inventory.map(i => (
                        <div key={i.id} className="flex justify-between text-sm">
                          <span>{i.item_name ?? i.item_id.slice(0, 8)}</span>
                          <span className="font-mono">× {fmtNumber(i.quantity)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </TabsContent>
            </ScrollArea>
          </Tabs>

          {/* Resize handle: bottom-right corner */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-50"
            onMouseDown={onResizeStart}
            title="Drag to resize"
            style={{
              background:
                'linear-gradient(135deg, transparent 0%, transparent 50%, hsla(200, 85%, 65%, 0.6) 50%, hsla(200, 85%, 65%, 0.6) 100%)',
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
