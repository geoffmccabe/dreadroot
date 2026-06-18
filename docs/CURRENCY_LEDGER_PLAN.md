# Multi-Coin / Pool-Backed Ledger — design + plan (DRAFT for review)

Status: **proposal**. Nothing here is applied to the DB yet. Read + sign off on the shape, then
we build it in slices (bottom of doc). Shared DB → migrations apply to both DreadRoot + Pinkland.

## Goals (from the owner)

1. One generic system for **coins, tokens, and points** — DIVI is just one entry. Add any anytime.
2. **Sub-tokens / per-chain variants**: the *same* asset (e.g. USDT) exists on Ethereum, BSC, Base,
   etc. Each variant is its own balance + contract. Lists show the chain clearly and **indent the
   chain variants under their asset** so they read as grouped.
3. **Pool-backed**: every coin a player earns comes out of a **real reserve pool** the owner fills
   from outside the game. Earning *draws down* the pool; you can't mint more than is funded.
4. **Auto wallet on earn**: first time a player earns a coin, a **local (off-chain) wallet** is
   created for them. The internal balance is a claim on the pool — not on chain yet.
5. **Multiple wallets per asset**: a player can hold the same coin in a local in-world wallet *and*
   an attached external wallet (Divi / Trilium). A wallet may or may not be on chain.
6. **Withdrawal**: moving from a local wallet to an external wallet is a real on-chain transaction,
   processed through LW-SSO + DiviGo. Only this step touches the chain.

## What already exists (reused, not rebuilt)

- `token_themes` — a registry row per coin, already with on-chain fields (`blockchain`, `chain_id`,
  `contract_address`, `rpc_url`, `block_explorer_url`), image, color, drop-visual knobs. Admins can
  already insert new rows. **We repurpose this as the per-chain VARIANT table** and add an asset
  parent above it.
- `user_token_balances` (user × token_theme × coins, with a `blockchain_address`) — **migrates into
  the new `wallets` table** (each row becomes a `local` wallet).
- Generic RPCs already take `p_token_theme_id` (`grant_currency`, `buy_block`, spend). We make them
  pool- and wallet-aware.
- `user_divi_balances` — DEAD legacy table (not even in the typed schema). `useDivi` / `DiviBalance`
  / `get_divi_balance` read it; they get repointed at the new ledger, then the table is dropped.

## Data model

Two-level registry (asset → per-chain variant), plus pools, wallets, and a transaction ledger.

### 1. `token_assets` — the brand / logical currency (NEW parent)

One row per asset: USDT, DIVI, Trilium, XP-Points…

| column         | type      | notes                                                            |
|----------------|-----------|------------------------------------------------------------------|
| id             | uuid PK   |                                                                  |
| symbol         | text      | 'USDT', 'DIVI', 'XP' — unique                                    |
| display_name   | text      | 'Tether USD'                                                     |
| kind           | text      | **'coin' \| 'token' \| 'points' \| 'stablecoin'** (categorize)   |
| logo_url       | text      | brand logo (shown on the asset header row)                       |
| color_palette  | jsonb     | brand colours (waterfall / coin look)                            |
| sort_order     | int       | list ordering                                                    |
| is_active      | bool      |                                                                  |

### 2. `token_themes` — per-chain VARIANT (EXISTING table, extended)

One row per (asset, chain). USDT has 3 rows (eth / bsc / base); a purely-internal coin has one row
with `network='internal'`, `is_onchain=false`. Pools, wallets, balances and prices all reference a
**variant** (`token_theme_id`), because USDT-on-Base ≠ USDT-on-Ethereum.

Add to the existing table:

| new column   | type | notes                                                              |
|--------------|------|--------------------------------------------------------------------|
| asset_id     | uuid | → token_assets (the parent brand)                                  |
| network      | text | 'ethereum' \| 'bsc' \| 'base' \| 'solana' \| 'internal' …           |
| is_onchain   | bool | false for an internal-only game coin / points                      |
| decimals     | int  | on-chain token decimals (display + transfer math)                  |

(Existing `chain_id`, `contract_address`, `rpc_url`, `block_explorer_url`, `coin_image_url`,
`coin_rate`, `color_palette`, drop-visual knobs stay — they're per-variant.)

### 3. `token_pools` — the reserve per variant (NEW)

The real coins the owner funds from outside. Earning debits `balance`; it can't go below 0.

| column          | type    | notes                                              |
|-----------------|---------|----------------------------------------------------|
| id              | uuid PK |                                                    |
| token_theme_id  | uuid    | → token_themes (variant) — UNIQUE                  |
| balance         | numeric | current reserve (drawn down on earn)               |
| total_funded    | numeric | lifetime added (audit)                             |
| total_dispensed | numeric | lifetime paid out (audit)                          |
| low_water_mark  | numeric | optional: warn/disable earning below this          |
| updated_at      | timestamptz |                                                |

### 4. `wallets` — a player's holding of a variant (NEW, replaces user_token_balances)

A user can have several wallets of the same variant: the auto-created **local** one + attached
**external** ones.

| column          | type    | notes                                                          |
|-----------------|---------|----------------------------------------------------------------|
| id              | uuid PK |                                                                |
| user_id         | uuid    |                                                                |
| token_theme_id  | uuid    | → token_themes (variant)                                       |
| kind            | text    | **'local'** (in-world, off-chain) \| **'external'** (attached) |
| is_onchain      | bool    | local = false; external = true                                 |
| address         | text    | null for local; the chain address for external                |
| balance         | numeric | internal ledger balance (local). External = cached/last-synced |
| label           | text    | "My Divi Wallet"                                               |
| is_primary      | bool    | the default wallet for this variant                            |
| created_at / updated_at | timestamptz |                                                  |

Constraints: one `local` wallet per (user, variant); external wallets unique on (user, variant,
address). Earnings always land in the `local` wallet (auto-created on first earn).

### 5. `token_transactions` — the ledger of movements (NEW)

Every credit/debit, for audit + to drive withdrawals + reconcile pool ↔ wallets ↔ chain.

| column          | type    | notes                                                          |
|-----------------|---------|----------------------------------------------------------------|
| id              | uuid PK |                                                                |
| token_theme_id  | uuid    | which variant                                                  |
| user_id         | uuid    | for filtering (nullable for pool_fill)                         |
| from_kind       | text    | 'pool' \| 'wallet' \| 'external'                               |
| from_wallet_id  | uuid    | nullable                                                       |
| to_kind         | text    | 'pool' \| 'wallet' \| 'external'                               |
| to_wallet_id    | uuid    | nullable                                                       |
| amount          | numeric |                                                                |
| reason          | text    | 'earn' \| 'spend' \| 'transfer' \| 'withdraw' \| 'deposit' \| 'pool_fill' |
| ref             | text    | source (monster kill id, listing id, …)                        |
| onchain_tx_hash | text    | set when it hits the chain (withdraw/deposit)                  |
| status          | text    | 'confirmed' (internal) \| 'pending' \| 'failed' (on-chain)     |
| created_at      | timestamptz |                                                            |

## RPC changes (server functions)

- **`grant_currency(p_token_theme_id, p_amount, p_user, p_reason, p_ref)`** — now atomic:
  1. `UPDATE token_pools SET balance = balance - p_amount WHERE token_theme_id = … AND balance >= p_amount RETURNING` → if no row, **pool dry → grant fails / is capped** (caller decides: skip drop, or clamp to remaining).
  2. upsert the user's **local** wallet (+ amount), creating it if first earn.
  3. insert a `token_transactions` row (pool → wallet, 'earn').
- **`spend_currency` / `buy_block`** — debit the user's local wallet for that variant; refund the
  pool (or a sink); ledger row.
- **`fund_pool(p_token_theme_id, p_amount)`** (admin) — add to the pool; ledger row (external →
  pool, 'pool_fill'). This is how the owner tops up from outside.
- **`request_withdrawal(p_wallet_id, p_dest_address, p_amount)`** (Slice 4) — hold the amount on the
  local wallet, write a `pending` 'withdraw' tx, hand off to the SSO/DiviGo bridge to do the real
  on-chain send; on confirmation mark `confirmed` + store `onchain_tx_hash`.

Coin drops: the existing `spawn_coin_drop` / `roll_monster_coin_drop` route through `grant_currency`
on pickup, so they become pool-backed automatically.

## UI — sub-token display (asset → indented chain variants)

Group by asset, indent each chain variant under it, label the chain clearly. Example wallet list:

```
DIVI                                  1,250
   └ Game (internal)                  1,250
USDT                                     52.50
   └ Ethereum                           40.00
   └ Base                               12.50
   └ BSC                                 0.00
TRILIUM                                 300
   └ Trilium Chain                      300
```

- Asset header row = brand logo + symbol + summed balance across its variants.
- Indented child rows = one per network/chain the player holds, with the chain label + that
  variant's balance. Zero-balance variants can be hidden or shown greyed (toggle).
- The same indented grouping is reused anywhere coins are listed (marketplace pricing picker, admin
  pool manager, drop-config coin picker).

## Migration from today

1. Create `token_assets`; for each existing `token_themes` row, create/attach an asset (group rows
   that are the same brand under one asset; set `asset_id`, `network`, `is_onchain`, `decimals`).
2. Create `token_pools` (one per variant, balance 0 — owner funds via `fund_pool`).
3. Create `wallets`; copy every `user_token_balances` row → a `local` wallet (is_onchain false).
4. Repoint `useDivi` / `DiviBalance` / `get_divi_balance` at the new wallet ledger; then drop the
   dead `user_divi_balances`.
5. Marketplace: replace `price_divi` with `price_token_theme_id` + `price_amount` (price a listing
   in any variant). Keep a compat read during transition.

## Build plan (slices)

- **Slice 1 — Registry split.** `token_assets` + extend `token_themes` (asset_id/network/is_onchain/
  decimals) + admin UI to manage assets and their per-chain variants. No behavior change yet.
- **Slice 2 — Pools.** `token_pools` + `fund_pool` admin + make `grant_currency` debit the pool
  (earning is now backed). Admin pool manager shows balance / funded / dispensed per variant.
- **Slice 3 — Ledger + wallets.** `wallets` + `token_transactions`; migrate `user_token_balances`;
  wallet-aware spend/earn; the indented asset→chain wallet UI; retire `user_divi_balances`.
- **Slice 4 — Attach external wallet.** Let a player register an external Divi/Trilium address as an
  `external` wallet (no value movement yet — just linking + display).
- **Slice 5 — Withdrawal bridge.** `request_withdrawal` + the LW-SSO/DiviGo on-chain send + status
  tracking. **Gated on the DiviGo/SSO API existing.**

Slices 1–3 are fully internal (no external dependency) and deliver the pool-backed multi-coin ledger.
4–5 add real on-chain movement once the DiviGo side is ready.
