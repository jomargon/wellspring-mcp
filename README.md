# Wellspring for Withings

**Unofficial integration for Withings devices.** Not affiliated with, endorsed
by, or supported by Withings. Withings is a trademark of its respective owner.

Ask your AI assistant about your own Withings health data: sleep, body
measurements, activity, and heart. Read-only. No health data is ever stored
server-side. Works with **any AI that supports remote MCP (Model Context
Protocol) connectors**, including Claude, ChatGPT, and Gemini CLI.

## Quickstart

Your connector URL: `https://wellspring.fit/mcp`

- **Claude:** open **Settings → Connectors → Add custom connector**, paste the
  URL, and follow the prompts to approve access and sign in to Withings.
- **ChatGPT** (Plus/Pro/Business/Enterprise/Edu): enable **Developer mode** in
  settings, then add the URL as a custom connector (recently renamed "apps")
  and complete the same approval and Withings sign-in.
- **Gemini:** the consumer Gemini app doesn't take custom connectors yet; with
  **Gemini CLI**, add the URL as a remote MCP server under `mcpServers` in
  `settings.json`.
- **Any other MCP client:** add the URL as a remote MCP server. Your
  assistant's documentation will say where. The sign-in flow handles the rest.

Then try asking:

- *"How did I sleep last week?"*
- *"What's my weight trend this month?"*
- *"How active was I compared to the week before?"*
- *"Is my Withings scale battery OK?"*

## Privacy

- **Read-only.** Nothing is ever written to your Withings account.
- **Four data categories**, fetched only when you ask: sleep, body
  measurements, activity, heart.
- **Only OAuth tokens are stored**, encrypted at rest with an app-layer key on
  top of Cloudflare's storage encryption
  ([`src/tokens/crypto.ts`](src/tokens/crypto.ts)); health measurements are
  never persisted.
- **Nothing sensitive is logged.** Logging is allowlist-only: tool name,
  latency, outcome, and a hashed user id
  ([`src/tools/shared.ts`](src/tools/shared.ts)). Never request or response
  bodies, never tokens.
- Full policy: [wellspring.fit/privacy](https://wellspring.fit/privacy).

## Disconnecting

- **One step:** open [wellspring.fit/disconnect](https://wellspring.fit/disconnect).
  It revokes Withings access server-side (via the Withings `revoke` endpoint)
  and deletes the stored tokens.
- Then remove the connector in your AI assistant's settings (in Claude:
  **Settings → Connectors**).
- You can also revoke access manually any time in your
  [Withings account](https://account.withings.com) under Apps & Partners.

## Troubleshooting

- **"Needs reconnect" errors:** open the reconnect link in the error message
  (or `wellspring.fit/withings/connect`). One click, about 30 seconds, and
  your history stays intact.
- **Data missing or stale:** your device may not have synced. Open the
  Withings app to trigger a sync, and ask your assistant to run `get_devices`.
  A low battery is the most common cause.
- **No data at all in a range:** the Withings API only serves data recorded by
  Withings devices. Data imported into the Withings app from other sources
  (e.g. Apple Health) shows in the app but never through the API. Also check
  that you have a device capable of recording that data type.

---

## For developers

### Architecture

```
MCP client (Claude, ChatGPT, …) ──(Streamable HTTP + OAuth 2.1)──► Cloudflare Worker
    ├── workers-oauth-provider — client-facing OAuth (PKCE, consent, tokens)
    ├── McpAgent (Agents SDK) — MCP transport + 7 read-only tools
    ├── Durable Object per user — Withings tokens, single-writer refresh
    └──► Withings API (wbsapi.withings.net), OAuth 2.0 upstream
```

Key properties: exactly one token refresh in flight per user (coalesced in the
Durable Object), new tokens durably written before use, a three-rung recovery
ladder (refresh → server-side `recoverauthorizationcode` → one-click re-auth),
and strict security headers (HSTS, CSP without `unsafe-inline`) on every page.

### Self-hosting

You can run your own independent instance for free. This removes the operator
(us) from your trust equation entirely, though it still runs on Cloudflare
infrastructure. If you want fully local, look at the existing local-first
Withings MCP projects instead.

1. Create a free [Cloudflare account](https://dash.cloudflare.com/sign-up)
   (Workers + Durable Objects free tier is enough).
2. Register your own app on the
   [Withings developer portal](https://developer.withings.com) (Public API
   plan) with the callback URL
   `https://<your-worker>.workers.dev/withings/callback`.
3. Clone this repo, then:

   ```sh
   npm ci
   cp .dev.vars.example .dev.vars   # fill in your Withings credentials + keys
   npx wrangler kv namespace create OAUTH_KV   # put the id in wrangler.jsonc
   npx wrangler secret put WITHINGS_CLIENT_ID
   npx wrangler secret put WITHINGS_CLIENT_SECRET
   npx wrangler secret put TOKEN_ENCRYPTION_KEY    # openssl rand -hex 32
   npx wrangler secret put COOKIE_ENCRYPTION_KEY   # openssl rand -hex 32
   npm run deploy
   ```

4. Add `https://<your-worker>.workers.dev/mcp` as a custom connector in your
   AI assistant (see Quickstart above).

### Local development

```sh
npm ci
npm run dev          # wrangler dev on port 8788
npm test             # Vitest in the real Workers runtime
npm run type-check   # tsc --noEmit (strict)
npm run lint         # Biome
```

Note: the Withings OAuth hop can only be verified against a deployed worker —
Withings exact-matches the registered redirect URI, so `localhost` never
receives the callback. Use `?demo=1` on the connect flow to test with
Withings' demo user (no device needed).

## License & contact

Apache-2.0 · hello@wellspring.fit
