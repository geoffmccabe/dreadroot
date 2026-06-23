# Dread Points (DP) — Universal In-Game Currency Plan

## North Star

**DP is the single, closed-loop, spendable currency of the game.** You earn it by playing
(killing monsters), and you spend it in-game (bullets, blocks, land, items). Everything else —
cash, DIVI, $DREAD, other cryptos — converts **INTO** DP. **Nothing converts OUT of DP** until the
GoBanq phase, by design.

Why "no escape" matters: a closed-loop currency redeemable only for in-game goods is treated like
arcade tokens / game gold — not regulated money transmission. The moment DP can be cashed out to
money/crypto it becomes redeemable stored value → money-transmitter territory → needs a license +
per-country KYC. That capability is isolated entirely inside **GoBanq** (Costa Rica MTL entity),
which is the deferred final phase. Keeping the out-ramp in one licensed module keeps the games clean.

Per-game branding: the same machine runs **DP** (Dreadroot), **$PINK** (Pinkland), **$SIEGE** (Siege
Worlds). Each is its own currency variant; a player holds separate balances per game.

This is how mature games run it: one hard in-game currency, many on-ramps, careful faucet/sink
balancing, an append-only ledger, and a closed loop until a licensed entity opens the cash-out door.

---

## What already exists (reuse, don't rebuild)

The multi-currency ledger is already the right shape — DP slots straight in:

- **token_assets** (the brand) → has a `kind` column that already includes `'points'`.
- **token_themes** (per-chain variant of a brand; `network='internal'` for game currencies).
- **token_pools** (reserve per variant: `'funded'` = hard-capped by admin top-ups, `'minted'` = uncapped faucet).
- **user_token_balances** (`user_id × token_theme_id → coins`) — the spendable balance, **RLS-locked**: only SECURITY DEFINER RPCs can change it (no client writes). 
- Crediting/spending RPCs already take a `token_theme_id`, are atomic, pool-aware, and replay-protected:
  `grant_currency`, `buy_block`, `pickup_coin_drop`, `spawn_coin_drop`, `ensure_token_balance`, `fund_pool`.
- **CoinThemeContext** picks the "active" coin from `app_settings.active_token_theme_id` and drives the HUD.

**Security foundation is solid:** every spend is server-authoritative; there are no client-writable
currency paths today. That's the hard part, and it's done.

## What's missing / in the way

1. **Two parallel currencies.** Shop (blocks/seeds) spends `user_token_balances.coins`; the P2P
   **marketplace and the fountain still use the legacy `user_divi_balances`** table. DP must unify these.
2. **DreadRoot kills don't drop coins yet.** Siege Worlds does (`dropSiegeDivi` → hardcoded `'divi'`,
   amount = round(maxHealth/10), ×2 on fountain, disabled in challenge mode). DreadRoot has the config
   table (`monster_coin_drops`) + RPC (`roll_monster_coin_drop`) built but **not wired into kill handlers**.
3. **No conversion/swap mechanism** of any kind (no rates, no convert RPC).
4. **No append-only ledger.** Balances are just current totals; only the marketplace logs transactions.
   A real-value currency (and future compliance) needs every credit/debit recorded immutably.
5. **No per-game currency selection.** One global active theme; currency is shared across games.
6. **Marketplace is DIVI-locked** (`price_divi` text columns).

---

## Phased plan

### Phase 0 — Decisions (quick, no code)
- Confirm names/tickers: DP (Dreadroot), $PINK (Pinkland), $SIEGE (Siege Worlds); symbol + logo each.
- Confirm DP is **minted by play** (faucet) and **sold** (cash/crypto in) — issuance tracked, not reserve-backed, until GoBanq.
- Confirm closed-loop: **no out-ramp** ships before GoBanq.

### Phase 1 — DP becomes the in-game currency (Dreadroot)
- Seed the DP brand: `token_assets` (kind=`points`) + `token_themes` (`internal`) + `token_pools` (`minted`).
- **Faucet:** wire DreadRoot monster-kill handlers to `roll_monster_coin_drop` crediting DP (the missing
  wiring), and switch the Siege drop from hardcoded `'divi'` to the per-game theme. Keep the
  maxHealth/10 formula, fountain ×2, and challenge-mode-off rules.
- **Sink:** point the shop (`buy_block`) at DP (it already uses the active theme — just make DP active for Dreadroot).
- **Ledger (new, important):** add an append-only `dp_ledger` (user, delta, reason, balance_after,
  ref_id, created_at). Every grant/spend RPC writes one row. This is the audit/history backbone and a
  prerequisite for compliance later.
- Keep XP (`user_profiles.total_points` → level) exactly as-is — that's progression, not spendable DP. They stay separate.

### Phase 2 — Unify all spending onto DP
- Migrate the **marketplace** off `user_divi_balances`: add `token_theme_id` to listings/transactions,
  price in DP, route `marketplace_purchase` through `user_token_balances` (DP). Convert legacy DIVI
  balances to DP at a set rate on migration.
- Migrate the **fountain** donation to DP.
- Retire `user_divi_balances` (keep as historical record). Result: **one spendable currency** everywhere.
- New sinks the design calls for: **bullets/ammo** and **land/plots** (neither exists yet) — add as DP-priced, server-validated purchases.

### Phase 3 — The Points Panel (UI)
A new panel in the User Panel (and a compact HUD readout), branded per game:
- Big DP balance + icon; "how to earn" (kill monsters) and live earn/spend.
- **Ledger view** (from `dp_ledger`): recent credits/debits with reason.
- **Convert-IN** entry points (cash / crypto → DP) — Phase 4.
- A "Cash out (coming soon — via GoBanq)" placeholder so the future is visible but closed.
- Uses the existing card/theme styling; per-game branding via the active theme (DP/$PINK/$SIEGE).

### Phase 4 — Convert INTO DP (on-ramps, one-way)
- `currency_conversions` config (from_theme → DP, rate, **direction = in-only**) + a `convert_to_dp`
  RPC that atomically debits the source and credits DP, writing the ledger. No out-ramp exists in code.
- **Cash → DP:** reuse the **Stripe** integration already built for subscriptions — a checkout that
  credits DP on payment (webhook → `convert_to_dp`).
- **Crypto → DP:** player sends DIVI/other to a pool deposit address (the `token_pools.deposit_address`
  + sync infra already exists) → credited as DP at the configured rate.
- Existing VIP-gating holdings (`user_external_holdings`) stay **separate** — they prove what you own
  on-chain for tiers; they are never spendable DP.

### Phase 5 — Per-game generalization ($PINK, $SIEGE)
- Replace the single global active theme with a **per-game** active theme (a game→theme mapping;
  Pinkland → $PINK, Siege → $SIEGE, Dreadroot → DP). Balances are already per-theme, so players hold
  separate per-game currencies automatically.
- Seed $PINK and $SIEGE brands; each game's faucet/sink/panel uses its own theme. The whole engine is
  identical — only the theme id differs per game.

### Phase 6 — $DREAD on Solana
- Create the **$DREAD** SPL token on Solana; register it as a `token_theme` (`network='solana'`, contract).
- Add **$DREAD → DP** as another in-ramp (buy DP with $DREAD at a rate). Helius/Solana read infra exists in the SSO.
- Still **no DP → $DREAD** out-ramp (that's GoBanq). $DREAD is for buying in + ecosystem, not cashing out yet.

### Phase 7 — GoBanq cash-out (DEFERRED, kept here intentionally)
- The ONLY path DP ever leaves the ecosystem: **DP → crypto/cash, exclusively through GoBanq** (Costa
  Rica money-transmitter license).
- A separate GoBanq module/service handles per-country **KYC**, limits, AML, and the actual payout.
  The `dp_ledger` balance is the source of truth for what a verified user may redeem.
- This flips DP from closed-loop to open-loop → which is exactly why it lives behind a licensed entity
  and is sequenced last. Nothing earlier in the plan opens this door.

---

## Cross-cutting (build these alongside, not after)
- **Append-only ledger** (Phase 1) — the single most important new piece; everything audit/compliance/history depends on it.
- **Faucet/sink economy tuning** — set kill-reward rates and item prices together so DP doesn't inflate; pools already let you hard-cap issuance per currency if desired.
- **Idempotency + anti-fraud** — extend the existing replay-protection + per-currency pools; add rate/drop caps.
- **Naming/branding config** — one place per game for ticker/symbol/logo/colors (token_assets already holds this).

## Suggested near-term slice
Phase 1 (DP live in Dreadroot: kills → DP, shop spends DP, ledger recording) is self-contained, high-value,
and proves the loop. Phase 2 (unify marketplace/fountout onto DP) removes the legacy DIVI split. Those two
deliver a real single-currency economy; everything after is on-ramps, branding, and the deferred cash-out.
