// Data hook for the rebuilt admin Users panel. Reads the SW player snapshot
// (4,000+ rows) with SERVER-SIDE pagination/sort/search so it stays fast, and
// overlays live Dreadroot account info (roles/coins) by email match.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SnapshotRow {
  sw_id: string;
  username: string | null;
  email: string | null;
  player_rights: number | null;
  last_login_date: string | null;
  total_minutes_played: number;
  total_kills: number;
  accuracy: number;
  distinct_items: number;
  total_items_held: number;
  max_single_stack: number;
  suspicious: boolean;
  suspicious_reasons: string | null;
  flagged: boolean;
}
export interface LiveAccount {
  id: string;
  email: string;
  roles: string[];
  coins: number | null;
  token_balances: { theme_name: string; coins: number }[];
  has_profile: boolean;
}
export interface PlayerRow extends SnapshotRow {
  account?: LiveAccount;
  nativeOnly?: boolean;
}
export type SortCol =
  | 'username' | 'player_rights' | 'last_login_date' | 'total_minutes_played'
  | 'total_kills' | 'accuracy' | 'total_items_held' | 'max_single_stack';

const LIST_COLS =
  'sw_id,username,email,player_rights,last_login_date,total_minutes_played,total_kills,accuracy,distinct_items,total_items_held,max_single_stack,suspicious,suspicious_reasons,flagged';

export function useAdminPlayers() {
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sortCol, setSortCol] = useState<SortCol>('total_items_held');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const [accountsOnly, setAccountsOnly] = useState(false);

  const accountsByEmail = useRef<Map<string, LiveAccount>>(new Map());
  const nativeOnly = useRef<PlayerRow[]>([]);
  const accountsLoaded = useRef(false);

  const loadAccounts = useCallback(async () => {
    if (accountsLoaded.current) return;
    accountsLoaded.current = true;
    try {
      const { data } = await supabase.functions.invoke('get-all-users');
      const users = (data?.users ?? []) as any[];
      const map = new Map<string, LiveAccount>();
      for (const u of users) {
        const email = (u.email || '').toLowerCase();
        if (!email) continue;
        map.set(email, {
          id: u.id, email, roles: u.roles || [], coins: u.profile?.coins ?? null,
          token_balances: u.token_balances || [], has_profile: !!u.has_profile,
        });
      }
      accountsByEmail.current = map;
      const emails = [...map.keys()];
      if (emails.length) {
        const { data: snap } = await supabase
          .from('sw_player_snapshot' as any).select('email').in('email', emails);
        const snapEmails = new Set(((snap as any[]) || []).map(r => (r.email || '').toLowerCase()));
        nativeOnly.current = emails.filter(e => !snapEmails.has(e)).map(e => {
          const a = map.get(e)!;
          return {
            sw_id: 'acct:' + a.id, username: a.email.split('@')[0], email: a.email,
            player_rights: null, last_login_date: null, total_minutes_played: 0, total_kills: 0,
            accuracy: 0, distinct_items: 0, total_items_held: 0, max_single_stack: 0,
            suspicious: false, suspicious_reasons: null, flagged: false, account: a, nativeOnly: true,
          } as PlayerRow;
        });
      }
    } catch (e) { console.error('[useAdminPlayers] accounts load failed', e); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await loadAccounts();
    let q = supabase.from('sw_player_snapshot' as any).select(LIST_COLS, { count: 'exact' });
    const s = search.trim().replace(/[%,()]/g, '');
    if (s) q = q.or(`username.ilike.%${s}%,email.ilike.%${s}%`);
    if (suspiciousOnly) q = q.eq('suspicious', true);
    q = q.order(sortCol, { ascending: sortAsc, nullsFirst: false })
         .range(page * pageSize, page * pageSize + pageSize - 1);
    const { data, count, error } = await q;
    if (error) { console.error('[useAdminPlayers] load failed', error); setRows([]); setLoading(false); return; }
    let list = ((data as any[]) ?? []) as PlayerRow[];
    for (const r of list) {
      if (r.email) { const a = accountsByEmail.current.get(r.email.toLowerCase()); if (a) r.account = a; }
    }
    if (page === 0 && !s && !suspiciousOnly && !accountsOnly && nativeOnly.current.length) {
      list = [...nativeOnly.current, ...list];
    }
    if (accountsOnly) list = list.filter(r => r.account);
    setRows(list);
    setTotal(count ?? 0);
    setLoading(false);
  }, [loadAccounts, search, suspiciousOnly, accountsOnly, sortCol, sortAsc, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const toggleSort = useCallback((col: SortCol) => {
    if (col === sortCol) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(false); }
    setPage(0);
  }, [sortCol]);

  return {
    rows, total, loading, page, setPage, pageSize, setPageSize,
    sortCol, sortAsc, toggleSort, search, setSearch,
    suspiciousOnly, setSuspiciousOnly, accountsOnly, setAccountsOnly, reload: load,
  };
}
