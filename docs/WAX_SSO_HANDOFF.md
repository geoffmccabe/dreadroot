# LW-SSO hand-off — make the Wax wallet embeddable in Dreadroot

For the SSO repo (the other Claude window). The Dreadroot side is already built (S2 + S3): it embeds
`${SSO}/wallet/wax?account=<wax>&embed=1&theme=dreadroot` in a sandboxed iframe, listens for
origin-checked `postMessage` from the SSO, and persists the connected Wax account. Four SSO changes
make it light up. Items 1–3 unblock the embed; item 4 unblocks token-gating.

## 1. Allow Dreadroot to frame the wallet (REQUIRED — without it the iframe is blank)

`next.config.ts` — add a `headers()` block scoped to the wallet route:

```ts
const FRAME_ANCESTORS =
  "frame-ancestors 'self' https://dreadroot.com https://*.dreadroot.com https://*.pages.dev https://*.lightningworks.io";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      { source: "/wallet/:path*", headers: [{ key: "Content-Security-Policy", value: FRAME_ANCESTORS }] },
    ];
  },
};
```

Make sure nothing else sends `X-Frame-Options: DENY|SAMEORIGIN` on `/wallet/*` (a global default would
override this and block the frame). CSP `frame-ancestors` is the modern equivalent and is what to use.

## 2. `?embed=1` — strip the SSO's own chrome

In the `/wallet/wax` page/layout, when `searchParams.embed === '1'` (and optionally
`theme === 'dreadroot'`), hide the SSO top-nav/footer/background so only the wallet card renders — so
it reads as a native Dreadroot panel. Pure CSS/conditional render; no logic change.

## 3. Tell the parent the connected account + height (`postMessage`)

From the wallet page, post to the parent **only** to allow-listed Dreadroot origins (never `'*'`):

```ts
const ALLOWED_PARENTS = [
  'https://dreadroot.com', 'https://sw.lightningworks.io',
  // add the exact *.pages.dev preview origin(s) you test from
];
function postToParent(msg: Record<string, unknown>) {
  const target = ALLOWED_PARENTS.find(o => o === (document.referrer ? new URL(document.referrer).origin : ''));
  if (target) window.parent?.postMessage({ source: 'lw-sso', ...msg }, target);
}

// once the account is known (already linked, or just connected via Wax Cloud Wallet):
postToParent({ type: 'wax-account', account });
// whenever the content height changes (optional, for no-scrollbar fit):
postToParent({ type: 'resize', height: Math.ceil(document.documentElement.scrollHeight) });
```

Dreadroot already handles both: it stores `wax-account` in `user_wallet_links` and rebuilds the iframe
URL from it; `resize` auto-fits the frame. (Origin is verified on Dreadroot's side too.)

## 4. `/api/wax-holdings` — the trustworthy gating source (server-to-server)

The iframe is display only — Dreadroot will NOT read balances from it (a client could forge a
`postMessage`). For token-gating (e.g. "≥ 1,000 TLM → +10% XP") Dreadroot's edge function calls this
endpoint server-to-server and mirrors the result into its own tables.

```
GET /api/wax-holdings        (auth: the SSO access token, same model as /api/verify)
->
{
  "account": "phmo4.c.wam",
  "tokens": [
    { "symbol": "TLM",   "contract": "alien.worlds", "amount": 1234.5678, "decimals": 4 },
    { "symbol": "MAGOR", "contract": "<contract>",   "amount": 10,        "decimals": 4 }
    // … TLM + the 6 planet coins
  ],
  "nfts": [
    { "collection": "alien.worlds", "schema": "tool", "template_id": 12345, "count": 3 }
    // … AtomicAssets holdings, aggregated by template (or schema)
  ]
}
```

Amounts are decimal (already divided by `decimals`). This is the authoritative token list too — so
Dreadroot creates/updates the WAX `token_assets`/`token_themes` from it and never hardcodes a contract.

## Order

1 → embed renders inside Dreadroot. 2 → it looks native. 3 → per-user, no test account. 4 → gates fire.
Ping when 1–3 are deployed and I'll confirm the embed renders; ping when 4 exists and I'll wire the
sync (`sync-wax-holdings`) on the Dreadroot side.
