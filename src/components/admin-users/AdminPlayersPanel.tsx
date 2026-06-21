// Rebuilt admin Users panel — handles 4,000+ players with server-side
// pagination/sort/search, cheater flags, and per-player detail/actions.
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdminPlayers, type PlayerRow, type SortCol } from './useAdminPlayers';
import { PlayerDetailModal } from './PlayerDetailModal';

const COLUMNS: { key: SortCol; label: string }[] = [
  { key: 'username', label: 'Player' },
  { key: 'player_rights', label: 'Rights' },
  { key: 'last_login_date', label: 'Last login' },
  { key: 'total_kills', label: 'Kills' },
  { key: 'total_minutes_played', label: 'Mins' },
  { key: 'accuracy', label: 'Acc' },
  { key: 'total_items_held', label: 'Items' },
  { key: 'max_single_stack', label: 'Max stack' },
];
const PAGE_SIZES = [25, 50, 100, 200];

export function AdminPlayersPanel() {
  const p = useAdminPlayers();
  const [detail, setDetail] = useState<PlayerRow | null>(null);
  const pages = Math.max(1, Math.ceil(p.total / p.pageSize));
  const arrow = (c: SortCol) => (p.sortCol === c ? (p.sortAsc ? ' ▲' : ' ▼') : '');

  return (
    <div className="flex flex-col h-full gap-2 text-xs">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <Input
          value={p.search}
          onChange={(e) => { p.setSearch(e.target.value); p.setPage(0); }}
          placeholder="Search name or email…"
          className="h-8 w-64 text-xs"
        />
        <Button size="sm" variant={p.suspiciousOnly ? 'default' : 'outline'} className="h-8 text-xs"
          onClick={() => { p.setSuspiciousOnly(v => !v); p.setPage(0); }}>Suspicious</Button>
        <Button size="sm" variant={p.accountsOnly ? 'default' : 'outline'} className="h-8 text-xs"
          onClick={() => { p.setAccountsOnly(v => !v); p.setPage(0); }}>Has account</Button>
        <select
          value={p.pageSize}
          onChange={(e) => { p.setPageSize(parseInt(e.target.value, 10)); p.setPage(0); }}
          className="h-8 text-xs bg-background border border-border rounded px-1"
        >
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}/page</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] opacity-70">{p.total.toLocaleString()} players</span>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={p.page <= 0}
            onClick={() => p.setPage(x => Math.max(0, x - 1))}>Prev</Button>
          <span className="text-[10px] tabular-nums">Page {p.page + 1}/{pages}</span>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={p.page + 1 >= pages}
            onClick={() => p.setPage(x => x + 1)}>Next</Button>
        </div>
      </div>

      {/* table */}
      <ScrollArea className="flex-1 w-full rounded border border-border">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <tr className="text-left">
              {COLUMNS.map(c => (
                <th key={c.key}
                  className="px-2 py-1.5 font-medium cursor-pointer select-none whitespace-nowrap hover:text-primary"
                  onClick={() => p.toggleSort(c.key)}>{c.label}{arrow(c.key)}</th>
              ))}
              <th className="px-2 py-1.5 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {p.loading ? (
              <tr><td colSpan={9} className="px-2 py-6 text-center opacity-60">Loading…</td></tr>
            ) : p.rows.length === 0 ? (
              <tr><td colSpan={9} className="px-2 py-6 text-center opacity-60">No players match.</td></tr>
            ) : p.rows.map(r => (
              <tr key={r.sw_id}
                className="border-t border-border/40 hover:bg-white/5 cursor-pointer"
                onClick={() => setDetail(r)}>
                <td className="px-2 py-1">
                  <div className="font-medium flex items-center gap-1">
                    {r.username || '(no name)'}
                    {r.account && <Badge variant="outline" className="text-[9px] px-1 py-0">acct</Badge>}
                    {r.nativeOnly && <Badge variant="secondary" className="text-[9px] px-1 py-0">native</Badge>}
                  </div>
                  <div className="text-[10px] opacity-60">{r.email || '—'}</div>
                </td>
                <td className="px-2 py-1">
                  {(r.player_rights ?? 0) >= 3
                    ? <Badge variant="outline" className="text-[9px] px-1 py-0">admin</Badge>
                    : <span className="opacity-70">{r.player_rights ?? 0}</span>}
                </td>
                <td className="px-2 py-1 whitespace-nowrap text-[10px]">{r.last_login_date || '—'}</td>
                <td className="px-2 py-1 tabular-nums">{r.total_kills?.toLocaleString()}</td>
                <td className="px-2 py-1 tabular-nums">{r.total_minutes_played?.toLocaleString()}</td>
                <td className="px-2 py-1 tabular-nums">
                  {r.accuracy
                    ? (r.accuracy > 1 ? <span className="text-red-400">{r.accuracy.toFixed(2)}</span> : r.accuracy.toFixed(2))
                    : '—'}
                </td>
                <td className="px-2 py-1 tabular-nums">{r.distinct_items}/{r.total_items_held?.toLocaleString()}</td>
                <td className="px-2 py-1 tabular-nums">{r.max_single_stack?.toLocaleString()}</td>
                <td className="px-2 py-1">
                  {r.suspicious && <Badge variant="destructive" className="text-[9px] px-1 py-0" title={r.suspicious_reasons || ''}>cheat?</Badge>}
                  {r.flagged && <Badge variant="destructive" className="ml-1 text-[9px] px-1 py-0">flagged</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>

      {detail && <PlayerDetailModal player={detail} onClose={() => setDetail(null)} onChanged={p.reload} />}
    </div>
  );
}
