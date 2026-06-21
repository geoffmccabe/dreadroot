// Per-player detail: full stats + item list + live-account actions (coins,
// roles) + cheater flag. Used by AdminPlayersPanel.
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { PlayerRow } from './useAdminPlayers';

const ROLE_OPTIONS = ['user', 'admin', 'superadmin'];

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-white/5 px-2 py-1">
      <div className="text-[10px] opacity-60">{label}</div>
      <div className="text-xs tabular-nums font-medium">{value}</div>
    </div>
  );
}

export function PlayerDetailModal({ player, onClose, onChanged }: {
  player: PlayerRow; onClose: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const acc = player.account;
  const [items, setItems] = useState<{ item_number: number; name: string; qty: number }[]>([]);
  const [flagged, setFlagged] = useState(player.flagged);
  const [coins, setCoins] = useState(acc?.coins?.toString() ?? '');
  const [roles, setRoles] = useState<string[]>(acc?.roles?.length ? acc.roles : ['user']);

  useEffect(() => {
    if (player.nativeOnly) return;
    (async () => {
      const { data } = await supabase
        .from('sw_player_snapshot' as any).select('items').eq('sw_id', player.sw_id).single();
      setItems(((data as any)?.items) ?? []);
    })();
  }, [player]);

  const saveFlag = async () => {
    const nf = !flagged;
    const { error } = await supabase.from('sw_player_snapshot' as any)
      .update({ flagged: nf }).eq('sw_id', player.sw_id);
    if (error) { toast({ title: 'Error', description: 'Flag failed', variant: 'destructive' }); return; }
    setFlagged(nf); onChanged();
    toast({ title: nf ? 'Flagged as cheater' : 'Unflagged', description: player.username || '' });
  };
  const saveCoins = async () => {
    if (!acc) return;
    const v = parseInt(coins, 10); if (isNaN(v)) return;
    const { error } = await supabase.from('user_profiles').update({ coins: v }).eq('user_id', acc.id);
    if (error) { toast({ title: 'Error', description: 'Coins update failed', variant: 'destructive' }); return; }
    onChanged(); toast({ title: 'Coins updated', description: `${v}` });
  };
  const saveRoles = async () => {
    if (!acc) return;
    await supabase.from('user_roles').delete().eq('user_id', acc.id);
    if (roles.length) {
      await supabase.from('user_roles').insert(roles.map(role => ({ user_id: acc.id, role })) as any);
    }
    onChanged(); toast({ title: 'Roles updated', description: roles.join(', ') || 'none' });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            {player.username || '(no name)'}
            {player.suspicious && <Badge variant="destructive" className="text-[10px]">suspicious</Badge>}
            {flagged && <Badge variant="destructive" className="text-[10px]">flagged</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="text-[11px] opacity-70 -mt-1">
          {player.email || 'no email'} · rights {player.player_rights ?? 0} · {player.sw_id}
        </div>
        {player.suspicious_reasons && (
          <div className="text-[11px] text-red-400">⚠ {player.suspicious_reasons}</div>
        )}

        <ScrollArea className="flex-1 -mx-1 px-1">
          {!player.nativeOnly && (
            <div className="grid grid-cols-4 gap-1.5 my-2">
              <Stat label="Kills" value={player.total_kills.toLocaleString()} />
              <Stat label="Minutes" value={player.total_minutes_played.toLocaleString()} />
              <Stat label="Accuracy" value={player.accuracy ? player.accuracy.toFixed(3) : '—'} />
              <Stat label="Item types" value={player.distinct_items} />
              <Stat label="Items held" value={player.total_items_held.toLocaleString()} />
              <Stat label="Max stack" value={player.max_single_stack.toLocaleString()} />
            </div>
          )}

          <div className="border-t border-border/50 pt-2 mt-1">
            <div className="text-xs font-medium mb-1">Dreadroot account</div>
            {acc ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  Roles:
                  {ROLE_OPTIONS.map(r => (
                    <label key={r} className="flex items-center gap-1 cursor-pointer">
                      <Checkbox checked={roles.includes(r)} onCheckedChange={(c) =>
                        setRoles(prev => c ? [...new Set([...prev, r])] : prev.filter(x => x !== r))} />
                      <span className="text-[11px]">{r}</span>
                    </label>
                  ))}
                  <Button size="sm" className="h-7 text-xs" onClick={saveRoles}>Save roles</Button>
                </div>
                <div className="flex items-center gap-2">
                  Coins:
                  <Input value={coins} onChange={e => setCoins(e.target.value)} className="h-7 w-28 text-xs" />
                  <Button size="sm" className="h-7 text-xs" onClick={saveCoins}>Save</Button>
                </div>
                <div className="text-[11px] opacity-70">
                  Tokens: {acc.token_balances.map(b => `${b.theme_name}:${b.coins}`).join(', ') || '—'}
                </div>
              </div>
            ) : (
              <div className="text-xs opacity-60">No live Dreadroot account yet (hasn't logged in).</div>
            )}
          </div>

          {!player.nativeOnly && (
            <div className="border-t border-border/50 pt-2 mt-2">
              <div className="text-xs font-medium mb-1">Items ({items.length})</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                {items.map((it, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="truncate">{it.name}</span>
                    <span className="tabular-nums opacity-70 ml-2">×{it.qty.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ScrollArea>

        <div className="flex gap-2 pt-2 border-t border-border/50">
          <Button size="sm" variant={flagged ? 'destructive' : 'outline'} className="h-8 text-xs" onClick={saveFlag}>
            {flagged ? 'Unflag' : 'Flag as cheater'}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs ml-auto" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
