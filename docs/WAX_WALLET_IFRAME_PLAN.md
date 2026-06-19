# Wax / Alien Worlds wallet — embed the LW-SSO wallet UI via iframe (plan)

Goal: show the SSO's existing Wax wallet UI (TLM + 6 planet coins + Alien Worlds NFTs) **inside**
Dreadroot/Siege as if it were a native panel, without forking the SSO code — and feed the holdings
into the token-gating engine. The user is already logged into Dreadroot via LW-SSO, so identity is
established. SSO edits (made in the other Claude window) appear in the iframe immediately on deploy.

Reference page: `https://sso.lightningworks.io/wallet/wax?account=<waxAccount>`

## Verdict — iframe, not a fork

- **iframe wins**: one source of truth, your SSO edits show up live (no Dreadroot redeploy), no
  duplicated crypto code, no second copy of keys/SDKs in the game bundle.
- **Why it's feasible here**: the wallet page is **account-parameterized** (`?account=…`) → it shows
  PUBLIC on-chain data for that account. So the iframe does NOT depend on the SSO's login *session*
  being readable cross-site (browsers block third-party cookies — that's what usually breaks framed
  wallets). We just pass the user's Wax account in the URL.

## The two data paths (keep them separate)

1. **DISPLAY (the iframe)** — the pretty SSO wallet UI, embedded. Read-only to the user's eyes.
2. **GATING (trustworthy balances)** — the numbers the game acts on for bonuses. These must be
   fetched **server-to-server** (Dreadroot edge function → SSO/Wax), NOT read from the iframe.
   **Security:** a hacked client can forge any `postMessage` the iframe sends, so iframe-reported
   balances are fine for *display/UX* but must never be trusted to grant real value. The token-gating
   engine reads `user_token_balances` / `user_nft_holdings`, which only a server sync may write.

## Auth / account flow

1. User logs into Dreadroot via LW-SSO (existing `sso-exchange`).
2. Dreadroot needs the user's **linked Wax account** to build the iframe URL. Get it from the SSO:
   - **Preferred:** `sso-exchange` (or a small new SSO endpoint, e.g. `/api/wax-account`) returns the
     linked Wax account alongside the email. Dreadroot stores it (e.g. `user_profiles.wax_account`,
     or a `user_wallet_links` row).
   - If **not linked yet**: load the iframe in "connect" mode (no `account` param) → the SSO page runs
     its Wax Cloud Wallet connect flow → on success the SSO posts the account back via `postMessage`
     → Dreadroot stores it and reloads the iframe with `?account=`.
3. Iframe src: `${SSO_BASE_URL}/wallet/wax?account=<wax>&embed=1&theme=dreadroot`.

## SSO side (other Claude window)

1. **Allow framing by Dreadroot.** Send on the `/wallet/*` responses:
   `Content-Security-Policy: frame-ancestors 'self' https://dreadroot.com https://*.dreadroot.com https://*.pages.dev https://*.lightningworks.io;`
   and ensure there is **no** `X-Frame-Options: DENY|SAMEORIGIN` on those routes. (Without this the
   iframe renders blank.)
2. **Embeddable layout.** Honor `?embed=1` → hide the SSO's own top-nav/footer so only the wallet
   card shows (so it reads as a Dreadroot panel). Optionally `?theme=dreadroot` to match colors.
3. **Account handoff to the parent.** After a successful Wax connect (or on load if already linked),
   `window.parent.postMessage({ source:'lw-sso', type:'wax-account', account }, '<dreadroot origin>')`.
   Always target the explicit Dreadroot origin, never `'*'`.
4. **(Gating) A server endpoint for balances/NFTs.** `GET /api/wax-holdings` (auth'd by the SSO token,
   server-to-server) returning `{ account, tokens:[{symbol, contract, amount, decimals}], nfts:[{collection, schema, template_id, count}] }`.
   This is what Dreadroot's sync calls — the trustworthy path. (The SSO already has this data from the
   wallet connection.)
5. **Resize signal (optional, nice):** post `{ source:'lw-sso', type:'resize', height }` so the iframe
   can auto-fit with no scrollbar.

## Dreadroot side (this repo)

1. **`WaxWalletPanel`** (`src/features/wallet/`): a styled Card wrapping an `<iframe>` to the SSO
   wallet URL. Loading shimmer; height from the resize postMessage (fallback fixed height); sandbox
   attrs (`allow-scripts allow-same-origin allow-popups allow-forms` — popups needed for WCW connect).
2. **Origin-checked postMessage listener**: accept messages ONLY from `SSO_BASE_URL`'s origin. Handle
   `wax-account` (store it) and `resize`. Ignore everything else.
3. **Get/store the Wax account**: `worldStore.getWaxAccount()` (reads the SSO-provided account) +
   persist it. Build the iframe URL from it.
4. **Mount**: in the User Panel → Wallet tab, shown only for games that use Wax (Dreadroot, Siege) —
   a "Wax Wallet" section/sub-tab above or beside the multi-coin list.
5. **Gating sync (server-authoritative)**: a `sync-wax-holdings` edge function — given the user's SSO
   token, call the SSO's `/api/wax-holdings`, then upsert `user_token_balances` (TLM + planet coins)
   and `user_nft_holdings` (AW NFTs). Trigger it: on login, on a `wax-account` postMessage, and on a
   timer/refresh. `useTokenGates` then evaluates real holdings → bonuses.
6. **Seed the tokens**: the sync auto-creates the token_assets/token_themes (TLM + 6 planets on WAX)
   from the SSO's token list the first time it sees them — so nothing is hardcoded; the SSO stays the
   source of truth.

## "Will my SSO edits show in the iframe?"

Yes. The iframe loads the **live deployed** SSO. Any change you ship to the SSO appears in the
Dreadroot iframe on next load — no Dreadroot rebuild. (Hard-refresh / cache-bust as usual.)

## Risks / gotchas

- **CSP frame-ancestors not set** → blank iframe. First thing to verify.
- **WCW connect inside an iframe**: Wax Cloud Wallet uses a popup; `allow-popups` + a user click make
  it work, but test on mobile (popup/redirect quirks). Fallback: a "Connect in new tab" button that
  opens the SSO wallet, then returns + re-syncs.
- **Don't trust iframe postMessage for value** — display only; gating uses the server sync.
- **Origin allow-list both ways**: SSO frame-ancestors must list every Dreadroot origin (prod +
  pages.dev previews + siege subdomain); Dreadroot's postMessage listener must pin the SSO origin.

## Build sequence

- **S1 (SSO)**: frame-ancestors header + `?embed=1` layout. → iframe renders inside Dreadroot.
- **S2 (Dreadroot)**: `WaxWalletPanel` + mount in the Wallet tab (account hardcoded for a first test).
- **S3 (SSO+DR)**: account handoff (postMessage / endpoint) + store the Wax account → dynamic per user.
- **S4 (gating)**: `/api/wax-holdings` (SSO) + `sync-wax-holdings` (DR) → real balances/NFTs in the
  game → token_gates fire bonuses.
