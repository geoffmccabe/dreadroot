# Supporter tiers — design + phased plan

Four levels: **Ordinary** (default) → **VIP** → **VIP Demi-God** → **VIP God**. A user reaches a tier
by **either** meeting its on-chain token/NFT requirements **or** holding a paid monthly subscription.

## Decisions (locked with owner)
- **Requirements: per-row OR/AND switch.** A tier qualifies by holdings if **any `or` row** is met,
  **or** **all `and` rows** are met. Paying the subscription is always an alternative.
- **Tiers are STANDALONE** — each grants only its own listed benefits (no inheritance). (Rocket boots
  "+1 per level" is expressed as the benefit value the admin sets per tier.)
- **Per-benefit cadence** — each benefit row picks `once` / `monthly` / `persistent`.
- **Payment processing is in scope** (crypto + cash) — built AFTER the panels (owner: "panels first").
- **Game-effect wiring is LATER** — Phase 1–3 only configure + display; benefits do NOT affect
  gameplay until a later phase. Do not wire game effects yet.

## Data model (4 tables — see migration 20260620100000_supporter_tiers.sql)
- `supporter_tiers` — level 1–3, name, `monthly_usd`, active. (3 rows seeded.)
- `supporter_requirements` — per tier: `match_mode` (or/and), token gate (theme + min) or NFT gate
  (collection/schema/template + min count).
- `supporter_benefits` — per tier: `benefit_key`, `value_type` (count/percent/toggle), `value`,
  `cadence` (once/monthly/persistent), enabled, note.
- `user_subscriptions` — user, tier, status, paid_until, method. Read-own; written by payment/admin.

Benefit catalog (starter — more later): blocks (by type), tree seeds, fortress seeds, eggs, chest
keys, rocket boots (+1/level), glide power.

## Phases
- **Phase 1 — DONE.** Schema + Admin → Users → **Supporters** tab: blockchains list + a card per tier
  with monthly $ + REQUIREMENTS editor (per-row OR/AND, token/NFT) + BENEFITS editor (value type +
  cadence + enable). Config only.
- **Phase 2** — User Panel **Support Level** sub-panel (under the user name): the 4 levels, the user's
  current one, each tier's requirements **or** price + benefits. Subscribe/upgrade button (wired in P4).
- **Phase 3** — effective-tier evaluation: compute a user's level from holdings (via the token-gate
  engine + the new requirements) OR an active subscription. Display only — no game effect.
- **Phase 4** — payment processing (crypto to the game WAX/pool wallet + cash via a provider) →
  creates/extends `user_subscriptions`. Needs its own decisions (provider for cash; crypto verify flow).
- **Phase 5 (LATER)** — wire each benefit into gameplay (grants on a schedule, rocket boots, glide,
  etc.). Not started until owner says go.
