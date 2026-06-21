// Rebuilt admin Users panel — handles 4,000+ players with server-side
// pagination/sort/search, cheater verdicts, VIP tiers, and per-player detail.
// Two collapsible sections: native Dreadroot accounts + Siege Worlds players.
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAdminPlayers, verdictOf, type PlayerRow, type SortCol } from './useAdminPlayers';
import { PlayerDetailModal } from './PlayerDetailModal';
import { vipColorVar, vipSize } from './vipStyle';

const COLUMNS: { key: SortCol; label: string }[] = [
  { key: 'username', label: 'Player' },
  { key: 'player_rights', label: 'Rights' },
];
const COLUMNS2: { key: SortCol; label: string }[] = [
  { key: 'last_login_date', label: 'Last login' },
  { key: 'total_kills', label: 'Kills' },
  { key: 'total_minutes_played', label: 'Mins' },
  { key: 'accuracy', label: 'Acc' },
  { key: 'total_items_held', label: 'Items' },
  { key: 'max_single_stack', label: 'Max stack' },
];
const PAGE_SIZES = [25, 50, 100, 200];

function FlagCell({ r }: { r: PlayerRow }) {
  const v = verdictOf(r);
  if (v === 'cheater') return <Badge variant="destructive" className="text-[9px] px-1 py-0">FLAGGED</Badge>;
  if (v === 'real') return <Badge className="text-[9px] px-1 py-0 bg-green-600 hover:bg-green-600 text-white">REAL</Badge>;
  if (r.suspicious) return <Badge className="text-[9px] px-1 py-0 bg-amber-600 hover:bg-amber-600 text-white" title={r.suspicious_reasons || ''}>cheat?</Badge>;
  return <span className="text-white/30">—</span>;
}

function Row({ r, onClick }: { r: PlayerRow; onClick: () => void }) {
  const nameCls = r.vip > 0 ? cn(vipSize(r.vip), 'font-bold') : 'text-white';
  const nameStyle = r.vip > 0 ? { color: vipColorVar(r.vip) } : undefined;
  return (
    <tr className="border-t border-white/10 hover:bg-white/10 cursor-pointer text-white" onClick={onClick}>
      <td className="px-2 py-1">
        <div className={cn('flex items-center gap-1', nameCls)} style={nameStyle}>
          {r.username || '(no name)'}
          {r.account && <Badge variant="outline" className="text-[9px] px-1 py-0 text-white border-white/30">acct</Badge>}
        </div>
        <div className="text-[10px] text-white/50">{r.email || '—'}</div>
      </td>
      <td className="px-2 py-1">
        {(r.player_rights ?? 0) >= 3
          ? <Badge variant="outline" className="text-[9px] px-1 py-0 text-white border-white/30">admin</Badge>
          : <span className="text-white">{r.player_rights ?? 0}</span>}
      </td>
      <td className="px-2 py-1">
        <span className={cn(vipSize(r.vip), r.vip > 0 && 'font-bold')} style={{ color: vipColorVar(r.vip) }}>{r.vip}</span>
      </td>
      <td className="px-2 py-1 whitespace-nowrap text-[10px] text-white">{r.last_login_date || '—'}</td>
      <td className="px-2 py-1 tabular-nums text-white">{r.total_kills?.toLocaleString()}</td>
      <td className="px-2 py-1 tabular-nums text-white">{r.total_minutes_played?.toLocaleString()}</td>
      <td className="px-2 py-1 tabular-nums text-white">
        {r.accuracy ? (r.accuracy > 1 ? <span className="text-red-400">{r.accuracy.toFixed(2)}</span> : r.accuracy.toFixed(2)) : '—'}
      </td>
      <td className="px-2 py-1 tabular-nums text-white">{r.distinct_items}/{r.total_items_held?.toLocaleString()}</td>
      <td className="px-2 py-1 tabular-nums text-white">{r.max_single_stack?.toLocaleString()}</td>
      <td className="px-2 py-1"><FlagCell r={r} /></td>
    </tr>
  );
}

function HeaderRow({ sortCol, sortAsc, onSort }: {
  sortCol?: SortCol; sortAsc?: boolean; onSort?: (c: SortCol) => void;
}) {
  const arrow = (c: SortCol) => (onSort && sortCol === c ? (sortAsc ? ' ▲' : ' ▼') : '');
  const th = (c: SortCol, label: string) => (
    <th key={c}
      className={cn('px-2 py-1.5 font-medium whitespace-nowrap text-white', onSort && 'cursor-pointer select-none hover:text-primary')}
      onClick={() => onSort?.(c)}>{label}{arrow(c)}</th>
  );
  return (
    <tr className="text-left">
      {COLUMNS.map(c => th(c.key, c.label))}
      <th className="px-2 py-1.5 font-medium text-white">VIP</th>
      {COLUMNS2.map(c => th(c.key, c.label))}
      <th className="px-2 py-1.5 font-medium text-white">Flags</th>
    </tr>
  );
}

function Collapsible({ title, count, defaultOpen, children }: {
  title: string; count: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded border border-white/15 bg-white/[0.02]">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-white font-medium hover:bg-white/5"
        onClick={() => setOpen(o => !o)}>
        <span className="text-white/60">{open ? '▼' : '▶'}</span>
        {title}
        <Badge variant="outline" className="ml-1 text-[10px] text-white border-white/30">{count.toLocaleString()}</Badge>
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

export function AdminPlayersPanel() {
  const p = useAdminPlayers();
  const [detail, setDetail] = useState<PlayerRow | null>(null);
  const pages = Math.max(1, Math.ceil(p.total / p.pageSize));

  return (
    <div className="flex flex-col h-full text-white text-xs">
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {/* Native Dreadroot accounts */}
        <Collapsible title="Native Dreadroot accounts" count={p.nativeAccounts.length}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead><HeaderRow /></thead>
              <tbody>
                {p.nativeAccounts.length === 0
                  ? <tr><td colSpan={10} className="px-2 py-3 text-center text-white/50">None</td></tr>
                  : p.nativeAccounts.map(r => <Row key={r.sw_id} r={r} onClick={() => setDetail(r)} />)}
              </tbody>
            </table>
          </div>
        </Collapsible>

        {/* Siege Worlds players */}
        <Collapsible title="Siege Worlds (SWU) players" count={p.total} defaultOpen>
          {/* toolbar */}
          <div className="flex items-center gap-2 flex-wrap py-1">
            <Input value={p.search}
              onChange={(e) => { p.setSearch(e.target.value); p.setPage(0); }}
              placeholder="Search name or email…" className="h-8 w-64 text-xs text-white" />
            <Button size="sm" variant={p.suspiciousOnly ? 'default' : 'outline'} className="h-8 text-xs"
              onClick={() => { p.setSuspiciousOnly(v => !v); p.setPage(0); }}>Suspicious</Button>
            <Button size="sm" variant={p.accountsOnly ? 'default' : 'outline'} className="h-8 text-xs"
              onClick={() => { p.setAccountsOnly(v => !v); p.setPage(0); }}>Has account</Button>
            <select value={p.pageSize}
              onChange={(e) => { p.setPageSize(parseInt(e.target.value, 10)); p.setPage(0); }}
              className="h-8 text-xs bg-background text-white border border-border rounded px-1">
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2 text-white">
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={p.page <= 0}
                onClick={() => p.setPage(x => Math.max(0, x - 1))}>Prev</Button>
              <span className="text-[10px] tabular-nums">Page {p.page + 1}/{pages}</span>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={p.page + 1 >= pages}
                onClick={() => p.setPage(x => x + 1)}>Next</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-background">
                <HeaderRow sortCol={p.sortCol} sortAsc={p.sortAsc} onSort={p.toggleSort} />
              </thead>
              <tbody>
                {p.loading
                  ? <tr><td colSpan={10} className="px-2 py-6 text-center text-white/60">Loading…</td></tr>
                  : p.rows.length === 0
                    ? <tr><td colSpan={10} className="px-2 py-6 text-center text-white/60">No players match.</td></tr>
                    : p.rows.map(r => <Row key={r.sw_id} r={r} onClick={() => setDetail(r)} />)}
              </tbody>
            </table>
          </div>
        </Collapsible>
      </div>

      {detail && <PlayerDetailModal player={detail} onClose={() => setDetail(null)} onChanged={p.reload} />}
    </div>
  );
}
