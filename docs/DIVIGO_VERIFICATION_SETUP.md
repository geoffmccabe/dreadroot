# DiviGo Verified Divi — Setup

Lets a player prove they control a Divi wallet (via the LW-SSO DiviGo Telegram link) and counts their
**custodial** DIVI toward supporter tiers / token gates. This is stronger than the self-custody RPC
path: the on-chain RPC can't see coins held inside DiviGo, and a pasted address proves nothing.

## How it works

1. Player clicks **Connect** (User Panel → Wallet → External Wallets → DiviGo).
2. Game redirects to the SSO consent screen `/wallet/divi/grant?app=dreadroot&scopes=balance:read`.
   If they haven't linked DiviGo yet, the screen makes them link via Telegram first (the proof of control).
3. On approve, the SSO mints a per-(user,app) `balance:read` bearer token and redirects back to the game
   with it in the URL fragment. The game stores it (via the `divigo-connect` edge fn) in
   `user_divigo_links` — a service-role-only table.
4. On **↻ Sync** (Support Level), `sync-holdings` calls the SSO OAuth balance API with that token and
   mirrors the player's custodial DIVI into `user_external_holdings` (marked verified). The Divi gate
   then sees it.

The token is `balance:read` only — it can NEVER move funds (every send needs Telegram approval). The
player can revoke it anytime at the SSO Account → Connections page.

## One-time setup

### A. Register DreadRoot as an app in the SSO (you, in the SSO admin)

1. Go to the SSO admin → **Apps** tab. Create/find an app with **slug `dreadroot`**.
2. Set **DiviGo enabled = true**.
3. Add the game's URL to the app's **redirect origins** (e.g. `https://dreadroot.com`). The consent
   screen refuses to return the token to a non-allow-listed origin.
4. Click **generate DiviGo secret** → copy the plaintext once (it can't be recovered; rotating makes a new one).

### B. Apply the migrations (Supabase SQL editor)

Run `20260620180000_divi_theme_identity.sql` (Divi ticker/chain) and `20260620200000_user_divigo_links.sql`
(the token table) if not already applied.

### C. Set game edge-function secrets (Supabase → Edge Functions → Secrets)

- `DIVIGO_APP_SLUG` = `dreadroot`
- `DIVIGO_APP_SECRET` = the secret from step A.4
- (`SSO_BASE_URL` defaults to `https://sso.lightningworks.io`)

### D. Deploy the edge functions

- `divigo-connect` (JWT on — identifies the player)
- `sync-holdings` (already deployed; redeploy to pick up the DiviGo branch)

## Test

External Wallets → DiviGo → **Connect** → approve in the SSO (link Telegram if prompted) → back in the
game it shows **✓ Connected** → Support Level → **↻ Sync** → your custodial DIVI counts toward the gate.
