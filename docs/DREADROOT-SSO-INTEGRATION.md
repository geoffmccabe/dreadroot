# Adding Lightningworks SSO to Dreadroot — Guide for the Dreadroot Claude

You're being given this by Geoff, who runs the SSO service. Geoff does **not**
remember the integration steps, so part of your job is to **walk him through the
manual steps he has to do on the SSO side** (he can't do them from the Dreadroot
codebase — they happen in the SSO admin panel and SSO server env). Do that
conversationally as you go; don't just dump this file at him.

There is a clean split of work:

- **Geoff does (SSO side, manual):** register the Dreadroot app, whitelist
  Dreadroot's domain, upload branding assets / set theme.
- **You do (Dreadroot side, code):** redirect to the login URL, capture the
  returned tokens, verify them.

Start by telling Geoff the two things only he can do (Steps 1 and 2 below), then
implement the Dreadroot code, then help him with branding.

---

## How the flow works (so you understand what you're building)

1. Dreadroot sends the user to the SSO login page with `?app=dreadroot&redirect=<dreadroot-url>`.
2. User logs in there (email/password, Google, Discord, or wallet — all handled by SSO).
3. SSO redirects back to your `redirect` URL with tokens in the **URL hash fragment**:
   `https://dreadroot.com/auth/callback#access_token=...&refresh_token=...&token_type=bearer`
4. Dreadroot grabs `access_token` from the fragment and POSTs it to the SSO
   `/api/verify` endpoint to get the verified user profile.
5. Dreadroot creates its own session from that profile.

It's a token-handoff model (not OIDC). No client secret is required — validation
is done by calling `/api/verify`.

---

## STEP 1 — Tell Geoff: register Dreadroot in the SSO admin panel (HE does this)

He needs to log into the SSO admin panel (superadmin) at the SSO site's
`/admin` page → **Apps** tab → **+ New App**, and create:

- **App Name:** `Dreadroot`
- **Slug:** `dreadroot` ← this is the value Dreadroot passes as `?app=dreadroot`. Confirm the exact slug with him; everything below assumes `dreadroot`.
- **Company:** pick an existing company or create one.
- Optionally upload the App Logo and App Side Image now (or later, in Step 3).

Ask him to confirm the **SSO base URL** (the domain the admin panel/login lives
on — likely something under `lightningworks.io`). Call it `<SSO_BASE_URL>` for
the rest of this guide. You need the real value to write the Dreadroot code.

## STEP 2 — Tell Geoff: whitelist the Dreadroot domain (HE does this)

The SSO refuses to redirect tokens back to any domain not in its allow-list.
Geoff must add Dreadroot's domain(s) to **both** of these env vars on the SSO
server (e.g. `.env.local` / hosting env), then redeploy/restart SSO:

- `NEXT_PUBLIC_ALLOWED_REDIRECT_ORIGINS` (used by the email/password path)
- `ALLOWED_REDIRECT_ORIGINS` (used by the OAuth callback path)

Both are comma-separated and support wildcard subdomains, e.g. append:

```
https://dreadroot.com,https://*.dreadroot.com
```

(`http://localhost:<port>` is always allowed automatically for local dev, so you
can test before the domain is whitelisted.)

If this isn't done, login will appear to work but the user will land back on the
SSO login page instead of returning to Dreadroot. If you see that symptom,
that's this step.

---

## STEP 3 — Implement the Dreadroot code (YOU do this)

### 3a. Send the user to login

When the user clicks "Log in", redirect the browser to:

```
<SSO_BASE_URL>/login?app=dreadroot&redirect=<URL-ENCODED dreadroot callback URL>
```

Example callback target: `https://dreadroot.com/auth/callback`

```js
const SSO_BASE = "<SSO_BASE_URL>";              // confirm with Geoff
const callback = "https://dreadroot.com/auth/callback";
window.location.href =
  `${SSO_BASE}/login?app=dreadroot&redirect=${encodeURIComponent(callback)}`;
```

Notes:
- The `app=dreadroot` param is what loads Dreadroot's branding on the login page.
- The `redirect` param **must** be on the whitelist from Step 2 (https, exact or
  wildcard match). For local dev use `http://localhost:<port>/auth/callback`.

### 3b. Capture the tokens on the callback page

SSO returns to `redirect` with tokens in the **hash fragment** (after `#`), not
the query string. Server frameworks don't see the fragment, so read it
client-side:

```js
// On https://dreadroot.com/auth/callback
const params = new URLSearchParams(window.location.hash.slice(1));
const accessToken  = params.get("access_token");
const refreshToken = params.get("refresh_token");   // store if you want refresh support
// Clear the fragment from the URL bar so tokens aren't left in history:
history.replaceState(null, "", window.location.pathname);
```

### 3c. Verify the token and get the user profile

POST the access token to the SSO verify endpoint. Prefer doing this from
Dreadroot's **server** (keeps it out of client trust), though CORS is open so
the browser can call it too.

```
POST <SSO_BASE_URL>/api/verify
Content-Type: application/json

{ "token": "<accessToken>" }
```

- **200** → `{ "valid": true, "user": { ... } }`
- **401** → `{ "error": "Invalid token" }` (reject the login)

The `user` object contains:

| Field | Notes |
|---|---|
| `id` | Stable Supabase user UUID — use this as the Dreadroot account key |
| `email` | |
| `username` | login/handle |
| `display_name` | shown name |
| `role` | `user` / admin role string |
| `avatar_url` | resolved URL (signed, ~7-day expiry) or null |
| `avatar_outer_color`, `avatar_inner_color` | hex, for avatar ring/fallback |
| `avatar_pan_x`, `avatar_pan_y`, `avatar_zoom` | avatar framing values |
| `created_at`, `last_sign_in` | timestamps |

Use `user.id` as the primary key when creating/looking up the Dreadroot account.
Then create Dreadroot's own session (cookie/JWT) — SSO's job ends at verify.

That's the whole integration: redirect out → catch fragment → verify → create
local session.

---

## STEP 4 — Branding / theming customization

Dreadroot's branding shows on the SSO **login page** when `?app=dreadroot` is
present. There are two layers:

### 4a. Images (Geoff uploads these in the admin panel)

In the Apps tab, editing the Dreadroot app:
- **App Logo** — shown in the login panel header (aim ~75px tall).
- **App Side Image** — character/art shown beside the login form (aim ~200px tall).

These are uploads; only Geoff can do them from the admin panel.

### 4b. Theme colors/fonts

Stored as a JSON `theme` on the Dreadroot app record (set in the admin panel's
theme editor). Every field is optional; anything omitted falls back to the SSO
default (dark UI, purple `#6a24fa` accent, Open Sans).

Resolution order, highest priority first:
1. URL query params on the login link (per-request override)
2. The app's saved `theme` (recommended for Dreadroot — set once)
3. The parent company's `theme`
4. Built-in defaults

Customizable fields:

| Field | Purpose |
|---|---|
| `primary_color` | buttons, links, accents |
| `primary_hover_color` | button hover |
| `bg_color` | page background |
| `panel_bg_color` | login panel background (supports rgba) |
| `text_color` | primary text |
| `text_secondary_color` | muted text |
| `input_bg_color` | form input background |
| `input_text_color` | form input text |
| `divider_color` | divider lines |
| `border_radius` | corner radius, e.g. `8px` |
| `font_family` | e.g. `'Cinzel', serif` |
| `font_size` | base size, e.g. `16px` |

**Recommended:** have Geoff set Dreadroot's palette once in the admin theme
editor so the link stays clean.

**Quick override option (no admin needed):** you can also pass theme fields as
URL params on the login link, URL-encoding `#`. Useful for testing a palette:

```
<SSO_BASE_URL>/login?app=dreadroot&redirect=...&primary_color=%23A35B4E&bg_color=%23120d0d
```

---

## What you need from Geoff before coding

Ask him for these up front:

1. **SSO base URL** (e.g. `https://sso.lightningworks.io` — confirm exact).
2. **Confirmation the app is registered** and the exact **slug** (assumed `dreadroot`).
3. **Confirmation Dreadroot's domain is whitelisted** in both redirect-origin env vars and SSO redeployed.
4. Dreadroot's production + dev **callback URLs** so he whitelists the right ones.
5. The **branding** he wants (logo, side image, colors) — relay/set per Step 4.

If 2 or 3 aren't done, login will fail in the specific ways noted above — point
him back to Step 1 / Step 2.
