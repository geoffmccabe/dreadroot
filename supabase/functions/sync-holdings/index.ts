// sync-holdings — mirror the caller's REAL on-chain holdings (across ALL their linked chains) into the
// gating mirrors so supporter-tier requirements + token gates evaluate them. Chain-agnostic: it reads
// every row in user_wallet_links for the user and, per chain, asks the SSO for holdings:
//   wax                      -> /api/wax-holdings?account=
//   ethereum | base | polygon-> /api/evm-holdings?address=&chain=
//   divi                     -> /api/divi-holdings?address=
// then writes:
//   - NFTs  -> user_nft_holdings       (count per collection/schema/template; EVM keyed by contract)
//   - tokens-> user_external_holdings  (amount per matched token_theme — NOT spendable balance)
// POST, auth = caller's JWT. Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
// optional SSO_BASE_URL. See docs/SUPPORTER_TIERS_PLAN.md.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const EVM_CHAINS = new Set(['ethereum', 'base', 'polygon'])

interface ThemeRow { id: string; ticker_symbol: string | null; blockchain: string | null; contract_address: string | null }
interface ReqRow { gate_kind: string; nft_chain: string | null; nft_collection: string | null; nft_schema: string | null; nft_template_id: number | null }
interface NftAcc { user_id: string; collection: string; schema_name: string; template_id: number; asset_count: number; updated_at: string }
interface ExtAcc { user_id: string; token_theme_id: string; chain: string; account: string; amount: number; updated_at: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'not authenticated' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const [linkRes, themeRes, reqRes, divigoRes] = await Promise.all([
    admin.from('user_wallet_links').select('chain, account').eq('user_id', user.id),
    admin.from('token_themes').select('id, ticker_symbol, blockchain, contract_address'),
    admin.from('supporter_requirements').select('gate_kind, nft_chain, nft_collection, nft_schema, nft_template_id'),
    admin.from('user_divigo_links').select('app_token').eq('user_id', user.id).maybeSingle(),
  ])
  const pastedLinks = ((linkRes.data as { chain: string; account: string }[]) ?? []).filter((l) => l.account)
  const divigoToken = (divigoRes.data as { app_token?: string } | null)?.app_token ?? null
  const themes = (themeRes.data as ThemeRow[]) ?? []
  const reqs = (reqRes.data as ReqRow[]) ?? []

  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
  // token_theme lookup: match by chain + (contract, else ticker). Divi falls back to ticker only.
  const findTheme = (chain: string, symbol: string, contract: string | null): string | null => {
    const sym = symbol.toUpperCase(), con = contract ? contract.toLowerCase() : null;
    for (const t of themes) {
      if (norm(t.blockchain) !== chain) continue;
      if (con && t.contract_address && t.contract_address.toLowerCase() === con) return t.id;
      if (!con && (t.ticker_symbol ?? '').toUpperCase() === sym) return t.id;
    }
    // ticker-only fallback (covers themes with no/zero blockchain field, e.g. Divi)
    for (const t of themes) if ((t.ticker_symbol ?? '').toUpperCase() === sym) return t.id;
    return null;
  }

  const SSO = (Deno.env.get('SSO_BASE_URL') ?? 'https://sso.lightningworks.io').replace(/\/$/, '')

  // Ownership-PROVEN addresses: the wallets the user connected (and signed with) in the SSO. Sourced
  // by email (login maps 1:1) via app credentials — trustworthy, unlike a pasted address. chain_type
  // maps: solana→solana, evm→ethereum (primary EVM), wax→wax, divi→divi.
  const appSlug = Deno.env.get('DIVIGO_APP_SLUG') ?? '', appSecret = Deno.env.get('DIVIGO_APP_SECRET') ?? ''
  const chainMap: Record<string, string> = { solana: 'solana', evm: 'ethereum', wax: 'wax', divi: 'divi' }
  const provenLinks: { chain: string; account: string }[] = []
  if (appSlug && appSecret && user.email) {
    try {
      const r = await fetch(`${SSO}/api/app/connected-wallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-LW-App-Slug': appSlug, 'X-LW-App-Secret': appSecret },
        body: JSON.stringify({ email: user.email }),
      })
      const d = await r.json()
      for (const w of (d.wallets ?? [])) {
        const chain = chainMap[String(w.chain).toLowerCase()];
        if (chain && w.address) provenLinks.push({ chain, account: String(w.address) });
      }
    } catch (e) {
      console.error('[sync-holdings] connected-wallets fetch failed', (e as Error).message)
    }
  }

  // Merge proven + pasted, dedupe by chain+account (proven first so it wins).
  const seenLink = new Set<string>()
  const links = [...provenLinks, ...pastedLinks].filter((l) => {
    const k = `${norm(l.chain)}:${l.account}`; if (seenLink.has(k)) return false; seenLink.add(k); return true;
  })
  if (!links.length && !divigoToken) return json({ error: 'no linked wallets', tokens: 0, nfts: 0 }, 400)

  const nowIso = new Date().toISOString()
  const nftAcc: NftAcc[] = []
  const extByKey = new Map<string, ExtAcc>() // key = token_theme_id (keep the largest amount seen)
  const pushExt = (themeId: string | null, chain: string, account: string, amount: number) => {
    if (!themeId) return;
    const prev = extByKey.get(themeId);
    if (!prev || amount > prev.amount) extByKey.set(themeId, { user_id: user.id, token_theme_id: themeId, chain, account, amount, updated_at: nowIso });
  }

  for (const link of links) {
    const chain = norm(link.chain), account = link.account;
    try {
      if (chain === 'wax') {
        const d = await fetch(`${SSO}/api/wax-holdings?account=${encodeURIComponent(account)}`).then((r) => r.json())
        for (const t of (d.tokens ?? [])) pushExt(findTheme('wax', t.symbol ?? '', t.contract ?? null), 'wax', account, t.amount ?? 0)
        for (const n of (d.nfts ?? [])) if (n.collection && (n.count ?? 0) > 0)
          nftAcc.push({ user_id: user.id, collection: n.collection, schema_name: n.schema ?? '', template_id: n.template_id ?? 0, asset_count: n.count, updated_at: nowIso })
      } else if (EVM_CHAINS.has(chain)) {
        const d = await fetch(`${SSO}/api/evm-holdings?address=${encodeURIComponent(account)}&chain=${chain}`).then((r) => r.json())
        for (const t of (d.tokens ?? [])) pushExt(findTheme(chain, t.symbol ?? '', t.contract ?? null), chain, account, t.amount ?? 0)
        // NFTs: only mirror contracts that a requirement actually gates on, keyed by the requirement's
        // exact nft_collection string so the client's strict collection match succeeds.
        const byContract = new Map<string, number>()
        for (const n of (d.nfts ?? [])) if (n.contract) byContract.set(String(n.contract).toLowerCase(), n.count ?? 0)
        for (const r of reqs) {
          if (r.gate_kind !== 'nft' || norm(r.nft_chain) !== chain || !r.nft_collection) continue;
          const count = byContract.get(r.nft_collection.toLowerCase()) ?? 0;
          if (count > 0) nftAcc.push({ user_id: user.id, collection: r.nft_collection, schema_name: r.nft_schema ?? '', template_id: r.nft_template_id ?? 0, asset_count: count, updated_at: nowIso })
        }
      } else if (chain === 'divi') {
        const d = await fetch(`${SSO}/api/divi-holdings?address=${encodeURIComponent(account)}`).then((r) => r.json())
        for (const t of (d.tokens ?? [])) pushExt(findTheme('divi', t.symbol ?? 'DIVI', null), 'divi', account, t.amount ?? 0)
      } else if (chain === 'solana') {
        const d = await fetch(`${SSO}/api/solana-holdings?address=${encodeURIComponent(account)}`).then((r) => r.json())
        for (const t of (d.tokens ?? [])) pushExt(findTheme('solana', t.symbol ?? '', t.contract ?? null), 'solana', account, t.amount ?? 0)
        // NFTs: mirror only collections a requirement gates on, keyed to the requirement's exact string.
        const byCollection = new Map<string, number>()
        for (const n of (d.nfts ?? [])) if (n.collection) byCollection.set(String(n.collection).toLowerCase(), n.count ?? 0)
        for (const r of reqs) {
          if (r.gate_kind !== 'nft' || norm(r.nft_chain) !== 'solana' || !r.nft_collection) continue;
          const count = byCollection.get(r.nft_collection.toLowerCase()) ?? 0;
          if (count > 0) nftAcc.push({ user_id: user.id, collection: r.nft_collection, schema_name: r.nft_schema ?? '', template_id: r.nft_template_id ?? 0, asset_count: count, updated_at: nowIso })
        }
      }
    } catch (e) {
      console.error(`[sync-holdings] ${chain} fetch failed`, (e as Error).message)
    }
  }

  // DiviGo custodial balance — authoritative (Telegram-verified) and includes coins the on-chain RPC
  // can't see. pushExt keeps the largest amount per theme, so this never double-counts a self-custody
  // Divi address; it just ensures custodial holders also qualify.
  if (divigoToken) {
    const slug = Deno.env.get('DIVIGO_APP_SLUG') ?? '', secret = Deno.env.get('DIVIGO_APP_SECRET') ?? ''
    if (slug && secret) {
      try {
        const d = await fetch(`${SSO}/api/oauth/divigo/balance`, {
          headers: { 'X-LW-App-Slug': slug, 'X-LW-App-Secret': secret, Authorization: `Bearer ${divigoToken}` },
        }).then((r) => r.json())
        const divi = Number((d?.balances ?? {}).divi ?? 0)
        if (divi > 0) pushExt(findTheme('divi', 'DIVI', null), 'divigo', 'divigo', divi)
      } catch (e) {
        console.error('[sync-holdings] divigo balance failed', (e as Error).message)
      }
    }
  }

  // Replace this user's OWN (live) mirror rows so sold-off assets drop out — but DON'T touch the
  // 'sw-legacy' rows written by the Siege Worlds VIP backfill. Those represent an honorary VIP that
  // only changes once the player actually re-certifies (a real DiviGo connect clears them; see
  // divigo-connect). Tag our writes source='sync' so this stays scoped.
  for (const r of nftAcc) (r as Record<string, unknown>).source = 'sync'
  await admin.from('user_nft_holdings').delete().eq('user_id', user.id).neq('source', 'sw-legacy')
  if (nftAcc.length) await admin.from('user_nft_holdings').insert(nftAcc)
  await admin.from('user_external_holdings').delete().eq('user_id', user.id).neq('source', 'sw-legacy')
  const extRows = Array.from(extByKey.values()).map((r) => ({ ...r, source: 'sync' }))
  if (extRows.length) await admin.from('user_external_holdings').insert(extRows)

  const chains = [...links.map((l) => l.chain), ...(divigoToken ? ['divigo'] : [])]
  return json({ ok: true, chains, tokens: extRows.length, nfts: nftAcc.length })
})
