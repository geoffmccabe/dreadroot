// Data hook for the rebuilt admin Users panel. Reads the SW player snapshot
// (4,000+ rows) with SERVER-SIDE pagination/sort/search so it stays fast, and
// overlays live Dreadroot account info (roles/coins/VIP) by email match.
// Splits out native-only Dreadroot accounts (no SW history) for a separate panel.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const REAL_SENTINEL = '__REAL__';

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
  admin_note: string | null;
  divi_live: number | null;   // real DIVI from the DiviGo backfill
  has_portal: boolean | null; // owns a LightningWorks Portal
}
export interface LiveAccount {
  id: string;
  email: string;
  roles: string[];
  coins: number | null;
  token_balances: { theme_name: string; coins: number }[];
  has_profile: boolean;
  vip: number;
}
export interface PlayerRow extends SnapshotRow {
  account?: LiveAccount;
  nativeOnly?: boolean;
  vip: number;
}
export type Verdict = 'cheater' | 'real' | null;
export function verdictOf(r: { flagged: boolean; admin_note: string | null }): Verdict {
  if (r.flagged) return 'cheater';
  if (r.admin_note === REAL_SENTINEL) return 'real';
  return null;
}

export type SortCol =
  | 'username' | 'player_rights' | 'last_login_date' | 'total_minutes_played'
  | 'total_kills' | 'accuracy' | 'total_items_held' | 'max_single_stack' | 'divi_live';

const LIST_COLS =
  'sw_id,username,email,player_rights,last_login_date,total_minutes_played,total_kills,accuracy,distinct_items,total_items_held,max_single_stack,suspicious,suspicious_reasons,flagged,admin_note,divi_live,has_portal';

export function useAdminPlayers() {
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [nativeAccounts, setNativeAccounts] = useState<PlayerRow[]>([]);
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
  const accountsLoaded = useRef(false);
  // Tier thresholds (config-driven) so the backfilled DIVI / Portal map to a VIP level.
  const diviThresholds = useRef<{ min: number; lvl: number }[]>([]);
  const portalTierLevel = useRef(0);

  // VIP a SW snapshot row earns from its backfilled on-chain holdings (DIVI amount / Portal NFT).
  const backfillVip = useCallback((divi: number | null, portal: boolean | null) => {
    let lvl = 0;
    for (const t of diviThresholds.current) if ((divi ?? 0) >= t.min) lvl = Math.max(lvl, t.lvl);
    if (portal) lvl = Math.max(lvl, portalTierLevel.current);
    return lvl;
  }, []);

  const loadAccounts = useCallback(async () => {
    if (accountsLoaded.current) return;
    accountsLoaded.current = true;
    try {
      // VIP per account = highest active-subscription tier level
      const [{ data: au }, { data: tiers }, { data: subs }, { data: reqs }, { data: diviTheme }] = await Promise.all([
        supabase.functions.invoke('get-all-users'),
        supabase.from('supporter_tiers' as never).select('id, level').then(r => r, () => ({ data: [] as any[] })),
        supabase.from('user_subscriptions' as never).select('user_id, tier_id, status, paid_until').then(r => r, () => ({ data: [] as any[] })),
        supabase.from('supporter_requirements' as never).select('tier_id, gate_kind, min_amount, token_theme_id').then(r => r, () => ({ data: [] as any[] })),
        supabase.from('token_themes').select('id').eq('name', 'divi').maybeSingle().then(r => r, () => ({ data: null })),
      ]);
      const tierLevel = new Map<string, number>(((tiers as any[]) || []).map(t => [t.id, t.level]));
      // Build the DIVI thresholds + Portal tier from the same requirements the live gate uses.
      const diviThemeId = (diviTheme as any)?.id ?? null;
      diviThresholds.current = ((reqs as any[]) || [])
        .filter(r => r.gate_kind === 'token' && (!diviThemeId || r.token_theme_id === diviThemeId))
        .map(r => ({ min: Number(r.min_amount) || 0, lvl: tierLevel.get(r.tier_id) ?? 0 }));
      portalTierLevel.current = Math.max(0, ...((reqs as any[]) || [])
        .filter(r => r.gate_kind === 'nft').map(r => tierLevel.get(r.tier_id) ?? 0));
      const now = Date.now();
      const vipByUser = new Map<string, number>();
      for (const s of ((subs as any[]) || [])) {
        if (s.status !== 'active') continue;
        if (s.paid_until && new Date(s.paid_until).getTime() < now) continue;
        const lvl = tierLevel.get(s.tier_id) ?? 0;
        vipByUser.set(s.user_id, Math.max(vipByUser.get(s.user_id) ?? 0, lvl));
      }
      const users = (au?.users ?? []) as any[];
      const map = new Map<string, LiveAccount>();
      for (const u of users) {
        const email = (u.email || '').toLowerCase();
        if (!email) continue;
        map.set(email, {
          id: u.id, email, roles: u.roles || [], coins: u.profile?.coins ?? null,
          token_balances: u.token_balances || [], has_profile: !!u.has_profile,
          vip: vipByUser.get(u.id) ?? 0,
        });
      }
      accountsByEmail.current = map;

      const emails = [...map.keys()];
      let snapEmails = new Set<string>();
      if (emails.length) {
        const { data: snap } = await supabase
          .from('sw_player_snapshot' as any).select('email').in('email', emails);
        snapEmails = new Set(((snap as any[]) || []).map(r => (r.email || '').toLowerCase()));
      }
      setNativeAccounts(emails.filter(e => !snapEmails.has(e)).map(e => {
        const a = map.get(e)!;
        return {
          sw_id: 'acct:' + a.id, username: a.email.split('@')[0], email: a.email,
          player_rights: null, last_login_date: null, total_minutes_played: 0, total_kills: 0,
          accuracy: 0, distinct_items: 0, total_items_held: 0, max_single_stack: 0,
          suspicious: false, suspicious_reasons: null, flagged: false, admin_note: null,
          divi_live: null, has_portal: null,
          account: a, nativeOnly: true, vip: a.vip,
        } as PlayerRow;
      }));
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
      const a = r.email ? accountsByEmail.current.get(r.email.toLowerCase()) : undefined;
      r.account = a;
      // Highest of: their paid subscription, or what their backfilled DIVI / Portal earns.
      r.vip = Math.max(a?.vip ?? 0, backfillVip(r.divi_live, r.has_portal));
    }
    if (accountsOnly) list = list.filter(r => r.account);
    setRows(list);
    setTotal(count ?? 0);
    setLoading(false);
  }, [loadAccounts, backfillVip, search, suspiciousOnly, accountsOnly, sortCol, sortAsc, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const toggleSort = useCallback((col: SortCol) => {
    if (col === sortCol) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(false); }
    setPage(0);
  }, [sortCol]);

  return {
    rows, nativeAccounts, total, loading, page, setPage, pageSize, setPageSize,
    sortCol, sortAsc, toggleSort, search, setSearch,
    suspiciousOnly, setSuspiciousOnly, accountsOnly, setAccountsOnly, reload: load,
  };
}
