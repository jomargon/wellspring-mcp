# Wellspring for Withings — Project Plan

A remote MCP server (**Wellspring**, repo/package `wellspring-mcp`, production domain `wellspring.fit`) that lets Claude read a user's Withings sleep, body, activity, and heart data. Hosted on Cloudflare Workers at $0/month, designed for near-zero ongoing maintenance, with token handling built around Withings' single-use rotating refresh tokens.

**How to use this document with an AI coding assistant (Claude Code or similar):** this file is the project's source of truth; when code and plan disagree, flag it rather than silently diverging. Setup tasks (account creation, domain settings, dashboard clicks) are human-only and live in the untracked `SETUP.local.md` (see §0) — do not attempt these, ask the developer to confirm they're done. Library APIs and template names drift: verify current Cloudflare Agents SDK / `workers-oauth-provider` APIs and the remote-MCP template name against live documentation before scaffolding, and fetch Withings' one-file AI context from developer.withings.com (they publish it specifically for coding assistants) rather than inventing endpoint details. Never place secrets in code, config, or fixtures — secrets live only in `.dev.vars` (local, gitignored) and Wrangler/GitHub secret stores. The security non-negotiables in §7 and the Definition of Done in §13 are acceptance criteria, not suggestions.

Two additional design goals shape every section below: **(a) Withings production approval readiness** — the app is built from day one to pass Withings' review and lift the 10-user integration cap, and **(b) end-user friendliness** — a non-technical user should be able to connect, use, and disconnect the service without ever contacting you.

The engineering bar: this is health-data infrastructure, so it is built to a production standard, not a hobby standard. Security is treated as a feature with its own requirements (§7), tests, and pre-launch audit — the non-negotiables in §7 are as binding as the functional requirements.

---

## 0. Pre-Development Setup — Step-by-Step

Operator-specific setup (account creation, domain/DNS configuration, Withings app registrations, local tooling, repo-visibility policy) lives in **`SETUP.local.md`** — an untracked file (`*.local.md` is gitignored). AI assistants: these are human-only tasks; ask the developer to confirm SETUP.local.md's exit criteria are met before scaffolding. Self-hosters: the public version of these steps is the README's self-hosting guide (§9.6); in short, you need a free Cloudflare account with Workers, your own Withings Public API app registration pointing at your callback URL, and this repo.

---

## 1. Architecture Overview

```
Claude (web/desktop/mobile)
        │  Streamable HTTP + OAuth 2.1 (client-facing)
        ▼
Cloudflare Worker  ──  workers-oauth-provider (authorizes Claude as an MCP client)
        │
        ├── McpAgent (Agents SDK) — MCP transport, tool definitions
        │
        ├── Durable Object per user — Withings tokens, single-writer refresh logic
        │
        └── HTTPS ──► Withings API (wbsapi.withings.net)
                        OAuth 2.0 upstream (account.withings.com/oauth2_user/authorize2)
```

There are two independent OAuth relationships, and keeping them mentally separate prevents most confusion during the build:

1. **Client-facing OAuth** — Claude authenticates *to your server*. Handled almost entirely by Cloudflare's `workers-oauth-provider` library; you do not design this flow, you configure it.
2. **Upstream OAuth** — your server authenticates *to Withings* on the user's behalf. This is the flow you build: authorize redirect, code exchange, token storage, rotation handling.

The bridge between them: when a new user completes the client-facing consent screen, you immediately bounce them into the Withings authorization flow, then store the resulting Withings tokens in that user's Durable Object. From then on, every MCP tool call resolves its Withings access token through the Durable Object.

---

## 2. Accounts to Create (all free)

Required external services, each on a free tier: a **Withings developer account** (Public API plan, no contract) with an app registration per environment; a **Cloudflare account** (Workers + Durable Objects — free plan requires the SQLite-backed DO storage class, which is what the Agents SDK template uses; production runs on a custom domain so the connector URL and OAuth redirect URIs stay portable forever); a **GitHub account** for hosting and Actions CI; and a **Withings user account with a device** for real-data testing (a demo user via `mode=demo` on the authorize URL covers pre-device testing and CI). Nothing else — no database vendor, no Redis, no monitoring service. That single-vendor consolidation is deliberate; it is the main reason this stack stays low-maintenance. Operator-specific details (registrar, domain, email, app names) are in `SETUP.local.md`.

---

## 3. Tech Stack and Tooling

**Language & runtime:** TypeScript (strict mode) on Cloudflare Workers. TypeScript is the MCP reference-implementation language, the Agents SDK is TypeScript-first, and the template ecosystem is richest here.

**Core dependencies:**

- `agents` (Cloudflare Agents SDK) — provides `McpAgent`, which implements the MCP server on top of a Durable Object and handles Streamable HTTP + legacy SSE transports.
- `@modelcontextprotocol/sdk` — MCP types and server primitives (used by `McpAgent`).
- `@cloudflare/workers-oauth-provider` — the client-facing OAuth 2.1 layer (dynamic client registration, PKCE, consent screen, token issuance to Claude).
- `zod` — runtime validation of both tool inputs and Withings API responses. Withings responses are loosely typed JSON with numeric status codes; validate at the boundary and the rest of the codebase stays honest.
- `wrangler` (dev dependency) — Cloudflare's CLI for local dev, secrets, and deployment.

**Dev tooling:** Vitest with `@cloudflare/vitest-pool-workers` (runs tests inside the actual Workers runtime, including Durable Objects), Biome for formatting + linting (single fast tool, one config file), and the **MCP Inspector** (`npx @modelcontextprotocol/inspector`) for interactively exercising tools during development.

**Starting point:** Cloudflare's official remote MCP server template with auth (`npm create cloudflare@latest -- --template=cloudflare/ai/demos/remote-mcp-github-oauth` or the current equivalent in their docs — verify the template name at build time, as these move). It ships with `workers-oauth-provider` already wired to an upstream provider; you replace the upstream (GitHub in the demo) with Withings. This is dramatically less error-prone than assembling the OAuth plumbing yourself.

---

## 4. Withings API Integration Details

**Base URL:** `https://wbsapi.withings.net`. **Authorize URL:** `https://account.withings.com/oauth2_user/authorize2`.

**Scopes:** request `user.info,user.metrics,user.activity` — this covers body measurements, sleep, heart, and activity. Request all three at first authorization; adding scopes later forces re-consent.

**Token exchange & refresh:** `POST /v2/oauth2` with `action=requesttoken`. Nonstandard details to expect: parameters go in the POST body, responses come back with HTTP 200 and a Withings `status` field in the JSON body (0 = success — always check it, never trust the HTTP code alone), and token responses nest under `body`. Access tokens last ~3 hours (`expires_in` = 10800); refresh tokens are single-use and rotate on every refresh.

**Signature/nonce:** some Withings endpoints (e.g., `getnonce`, `revoke`, `recoverauthorizationcode`) require HMAC-signed requests with a fresh nonce. The core data endpoints below do not — they take a Bearer token. Since `recoverauthorizationcode` is part of the token recovery ladder (§5), the signature helper is built in **Phase 2**, not deferred: one small module (`withings/signature.ts`) computing the HMAC-SHA256 of sorted params with the client secret, used by recovery and later reused by revocation. Verify the exact signing recipe against Withings' current signature documentation at build time.

**Secrets & configuration inventory** (all via `wrangler secret put` in deployed environments, `.dev.vars` locally; nothing else is secret): `WITHINGS_CLIENT_ID` + `WITHINGS_CLIENT_SECRET` (per environment — dev and prod apps differ), `TOKEN_ENCRYPTION_KEY` (32-byte random, for the app-layer AES-256-GCM in §7; generate with `openssl rand -hex 32`), plus whatever signing/cookie keys `workers-oauth-provider` requires per its current docs. Non-secret config (`wrangler.toml` vars): base URLs, environment name. If any secret ever leaks: rotate it at the source (Withings dashboard regenerates secrets; encryption key rotation requires a one-time re-encryption migration of stored tokens — write that migration only if needed).

**Endpoints per domain:**

| Domain | Endpoint | Action | Notes |
|---|---|---|---|
| Body | `/measure` | `getmeas` | Weight, fat %, muscle, hydration, bone mass via `meastypes`. Values use `value × 10^unit` encoding — normalize in one shared helper. |
| Sleep | `/v2/sleep` | `getsummary` | Per-night summaries: stages, duration, HR, breathing disturbances. `get` returns granular series if needed later. |
| Heart | `/v2/heart` | `list`, `get` | ECG recordings and heart data; BP readings arrive via `/measure` meastypes 9/10/11. |
| Activity | `/v2/measure` | `getactivity` | Daily steps, distance, calories, elevation. |
| Workouts | `/v2/measure` | `getworkouts` | Workout sessions with category and metrics. |
| Devices | `/v2/user` | `getdevice` | Device list + battery — cheap, useful diagnostic tool. |

**Rate limits:** ~120 requests/minute — chat usage will never approach this. Still, implement one retry with backoff on status 601 (too many requests).

---

## 5. Token Management (the critical component)

Design goal: **exactly one refresh in flight per user, new token durably written before use, and every failure state resolving to either self-heal or a single well-defined re-auth path.**

Implementation (as agreed in our earlier discussion):

- **One Durable Object per user**, keyed by the user's client-facing OAuth identity. `McpAgent` is already a Durable Object, which may let you store tokens directly in the agent's own storage — evaluate during the build; if per-session vs. per-user DO identity doesn't align, use a dedicated `UserTokens` DO addressed by user ID.
- **Proactive refresh** with a 5-minute expiry buffer; never send a token that could expire mid-request.
- **In-flight coalescing:** concurrent tool calls share a single refresh promise. The DO's single-threaded execution model plus the promise cache makes double-refresh structurally impossible.
- **Write-before-use:** `ctx.storage.put(tokens)` completes before the new access token is returned to any caller.
- **Ambiguous-failure handling — a three-rung recovery ladder:** on refresh timeout, retry once with the stored token. On `invalid_grant`, attempt Withings' `recoverauthorizationcode` webservice, which issues a new authorization code server-side without user involvement, then exchange it for fresh tokens. Only if recovery also fails, set `needs_reauth` and surface a clean MCP error containing a fresh authorization link. Withings notes recovery should be used sparingly (frequent use signals integration flaws), so log every recovery event — in a healthy deployment the counter stays near zero.
- **No background/cron refresh.** One writer, one code path.
- **Refresh tokens live 1 year**, so even users dormant for months reconnect silently on their next query.

**Re-auth as a first-class flow:** a dedicated `/withings/connect` route that any `needs_reauth` error links to, which runs the Withings authorize flow and overwrites the DO's tokens. Target: 30 seconds, one click, works even years later. With the recovery ladder in place, a real user should encounter this approximately never — but it must exist and must be pleasant.

---

## 6. MCP Tool Design

Seven tools, all read-only, each thin: validate input (zod) → get access token from DO → call Withings → normalize → return compact JSON.

1. `get_sleep_summary(start_date, end_date)` — nightly summaries.
2. `get_body_measurements(types?, start_date?, end_date?)` — defaults to weight + body comp, last 30 days.
3. `get_heart_data(start_date?, end_date?)` — HR/ECG/BP readings.
4. `get_activity(start_date, end_date)` — daily activity.
5. `get_workouts(start_date, end_date)` — workout sessions.
6. `get_devices()` — connected devices + battery; doubles as a connection health check.
7. `get_connection_status()` — reports token/auth state without touching health data; the first thing to check when something seems wrong.

Tool-design practices: ISO `YYYY-MM-DD` date inputs (convert to epoch internally, respecting the Withings distinction between `startdate`/`enddate` epochs and `startdateymd` string params per endpoint); default date ranges so Claude can call tools with zero arguments; normalize Withings' `value × 10^unit` encoding into plain floats with explicit units in the JSON; return concise summaries rather than raw dumps (token efficiency in chat); and write rich tool descriptions — they are prompts, and quality here determines how intelligently Claude uses the server. Let Claude do analysis; don't build "compare X vs Y" mega-tools.

**User-friendliness at the tool layer** (this is where most of the perceived UX lives, since chat *is* the UI):

- **Server `instructions` field:** the MCP spec lets a server hand the client usage guidance. Use it to tell Claude what the server is for, that dates default sensibly, to use `get_connection_status` first when something fails, and to present measurements in the user's preferred units. This one string does more for UX than any amount of UI polish.
- **Both unit systems in every response:** return weight as `{"kg": 82.4, "lb": 181.7}` and similar for distance/height. Claude then naturally speaks the user's dialect without a settings screen.
- **Timezone correctness:** Withings returns epochs and user timezone info; resolve "last night's sleep" against the *user's* timezone, not UTC. Getting this wrong is the most common way health integrations feel subtly broken.
- **Plain-language error strings:** every error a user can see is written for a human, names what happened, and states the one action to take (usually "click this link to reconnect" or "try again in a minute"). No status codes, no jargon, no dead ends.
- **Graceful empty states:** "No sleep data found for that range — your Withings sleep tracker may not have synced yet; opening the Withings app usually triggers a sync" beats an empty array. Distinguish "no data" from "no device" (via `getdevice`) so Claude can explain *why* data is missing.
- **Battery awareness:** `get_devices` includes battery levels; the server instructions tell Claude to mention a low battery when it explains missing data. Small touch, disproportionate goodwill.

---

## 7. Coding Practices

- **TypeScript strict** (`strict: true`, `noUncheckedIndexedAccess: true`). No `any` at the Withings boundary — zod schemas produce the types.
- **Small, boring modules:** `withings/client.ts` (HTTP + status-code handling), `withings/oauth.ts` (authorize/exchange/refresh), `tokens/do.ts` (Durable Object), `tools/*.ts` (one file per tool), `normalize.ts` (unit/date helpers).
- **Error taxonomy:** three user-visible categories — `needs_reauth` (with link), `withings_unavailable` (transient, suggest retry), `invalid_request` (bad params). Everything internal maps to one of these; never leak raw Withings errors or stack traces into chat.
- **Health-data privacy:** never log response bodies or tokens. Log only: user ID hash, endpoint, latency, status. Request minimal scopes; store nothing beyond tokens (measurement data is fetched on demand, never persisted). DO storage is encrypted at rest by Cloudflare.
- **Secrets:** `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET` and the OAuth provider's signing key via `wrangler secret put` (encrypted). Nothing secret in `wrangler.toml` or the repo. Provide `.dev.vars.example` for local dev.
- **Tests that matter (in priority order):**
  1. Concurrent `getAccessToken()` calls trigger exactly one upstream refresh.
  2. Failed storage write does not hand out the new token / does not orphan the old one.
  3. `invalid_grant` triggers `recoverauthorizationcode`; only its failure flips state to `needs_reauth`, and subsequent calls then return the re-auth error.
  4. Withings `status != 0` with HTTP 200 is treated as an error.
  5. Unit normalization (`value × 10^unit`), dual-unit output, and user-timezone date conversion round-trips.
  6. A recovered token chain resumes normal refresh behavior (no lingering `needs_reauth` state).
  Use `vitest-pool-workers` so DO behavior is tested in the real runtime; mock Withings with a global fetch spy (`vi.spyOn(globalThis, "fetch")` — `fetchMock` was removed from vitest-pool-workers; the worker and its DOs run in the test isolate, so global mocks reach them).
- **Dependency hygiene:** pin versions, commit the lockfile, CI installs with `npm ci`. **Dependabot security alerts + security-update PRs: always on** (silent until a real CVE affects a used dependency — the only mechanism that patches a dormant repo, since manual auditing stops happening once the project needs no attention and CI `npm audit` only runs on pushes). Version updates: quarterly manual bump-and-test, or if automated, monthly and grouped into one PR. This is essentially the entire ongoing maintenance workload.

**Security non-negotiables.** These are requirements, not aspirations; each gets verified in the Phase 4 audit and several are informed by auditing the strongest existing implementation:

- **OAuth hardening:** validate the `state` parameter on every Withings callback (CSRF protection); exact-match redirect URIs; PKCE on the client-facing flow (the oauth-provider library handles this — verify it's enabled, don't assume); Withings auth codes expire in 30 seconds, so exchange immediately and never store them.
- **Session–token binding:** bind each MCP session to the bearer token that created it, so a session ID can never be replayed by a different credential (cross-user session hijack prevention).
- **Defense-in-depth token encryption:** Durable Object storage is platform-encrypted at rest, but additionally encrypt refresh tokens at the application layer (AES-256-GCM, key from a Wrangler secret, random IV per encryption) — then a hypothetical storage-layer leak still yields nothing usable.
- **Transport & headers:** HTTPS only with HSTS; strict Content-Security-Policy with no `unsafe-inline` on all HTML pages; request body size limits; JSON-RPC messages validated against the spec before processing.
- **Validation everywhere:** zod-parse every tool input *and* every Withings response at the boundary; treat both directions as untrusted.
- **Logging by allowlist:** log only fields known to be safe (tool name, latency, error category, hashed user ID) rather than redacting fields known to be dangerous — allowlists fail closed, denylists fail open. Never log request/response bodies.
- **Rate limiting on auth routes:** per-IP limits on `/withings/connect` and the callback, so the OAuth endpoints can't be used for enumeration or abuse.
- **Least-privilege credentials:** the CI deploy token is scoped to Workers-edit on this account only; Withings scopes stay minimal; no Global API keys anywhere.
- **Supply chain:** GitHub secret scanning with push protection on; `npm audit` in CI (fail on high/critical); lockfile-only installs.
- **Pre-launch security audit (Phase 4 gate):** walk this list end-to-end, grep the codebase for any logging of tokens/bodies, confirm secrets exist only in Wrangler/GitHub stores, and attempt your own session-replay and CSRF against the dev deployment before going to production.

---

## 8. Deployment & Operations

**Environments:** two Wrangler environments — `dev` (default, `wellspring-mcp-dev.<subdomain>.workers.dev`, its own DO namespace and the "Wellspring (Dev)" Withings app registration so redirect URIs don't collide) and `production` (`wellspring.fit`). Local development runs `wrangler dev` with real Withings calls against the demo user.

**CI/CD (GitHub Actions):** on PR — typecheck, lint, test; on merge to `main` — `wrangler deploy` via `cloudflare/wrangler-action` using an API token stored as a GitHub secret. After the initial setup, "deploying" means "merging a PR."

**Observability:** enable Workers Logs (`[observability]` in `wrangler.toml`, free tier includes retention adequate for this). No external monitoring; if a tool call fails, logs are already there. Optionally add a free Cloudflare health check on `GET /health` later — likely unnecessary.

**Connecting Claude:** Settings → Connectors → Add custom connector → `https://wellspring.fit/mcp` (dev testing uses the workers.dev URL). Claude runs the OAuth flow (dynamic client registration is handled by `workers-oauth-provider`); the consent screen chains into Withings authorization; done. Verify with MCP Inspector first, then in Claude itself.

**Cost guardrails:** everything sits far inside free-tier limits (100K req/day Workers; DO free tier). Set a Cloudflare notification for approaching Workers limits anyway — a one-time toggle for peace of mind that this stays $0.

---

## 9. Onboarding & End-User Experience

The full journey a non-technical user takes, designed so no step requires your help:

1. **Landing/connect page** (`GET /` on the Worker): a simple, clean HTML page explaining what this is, what data it reads (read-only, and exactly which categories), what is stored (tokens only, never measurements), a link to the privacy policy, and copy-paste instructions for adding the connector in Claude (Settings → Connectors → Add custom connector → the URL). This page costs one static route and does triple duty: user onboarding, Withings reviewer first impression, and the thing you send friends instead of a paragraph of instructions.
2. **Consent screen** (from `workers-oauth-provider`): customize the default template with the app name, an "unofficial integration for Withings devices" subtitle, and the same read-only data summary. Immediately after consent, chain into the Withings authorization — the user experiences one continuous flow, not two separate logins.
3. **Starter prompt instead of an interstitial success page** *(amended in Phase 4)*: the first-connect callback must 302 straight back to Claude carrying the authorization code (30-second expiry; interposing HTML would put the code-bearing URL in page history — a leak surface §7 forbids). The "now what?" moment is solved where we do own the page: the consent screen, the landing page, and the re-auth success page all carry "go back to Claude and try: *How did I sleep last week?*".
4. **Steady state:** everything happens in chat. Errors self-explain (see §6), re-auth is one click, dormancy up to a year self-heals.
5. **Disconnect** *(amended in Phase 4)*: `workers-oauth-provider` fires no event when a user deletes the client-facing OAuth grant, so revocation cannot be triggered by connector removal as originally planned. Instead, a self-service **`/disconnect` page** is the real revocation path: the user re-proves account ownership via the Withings OAuth hop (the user id comes from Withings, never from user input), then the callback calls the Withings `revoke` endpoint (signature helper), clears the token DO, and revokes the client-facing grants — so "disconnect" genuinely severs access rather than orphaning a live token. Document both manual paths too: remove the connector in Claude, and revoke in the Withings account dashboard. This is also an approval signal (see §10).
6. **README as the front door.** The README serves three audiences at once — prospective users deciding whether to trust it, a Withings reviewer verifying claims, and anyone evaluating the work — so it's a deliverable with a spec, not an afterthought. Required contents, in order: (a) one-sentence description + "unofficial integration for Withings devices" disclaimer; (b) **user quickstart** — connect URL, the three-step Claude connector setup, and 3–4 example prompts to try first; (c) **privacy summary** — read-only access, exactly which data categories, tokens-only storage encrypted at rest, no health data ever persisted or logged, link to the full privacy policy and to the code that proves each claim; (d) how to disconnect (both the Claude side and Withings-side revocation); (e) troubleshooting the three realistic failures (needs-reauth, unsynced device, no data in range); (f) below the fold, for developers: architecture sketch, self-hosting guide (deploy your own independent instance to your own **free Cloudflare account** with your own Withings app registration — the answer for anyone who'd rather not trust yours; note honestly that this removes the operator from the trust equation but still runs on Cloudflare infrastructure, and point fully-local alternatives to the existing local-first Withings MCP projects), local dev setup, and test instructions; (g) license and contact (`hello@wellspring.fit`). Anti-goals: no badge walls, no changelog prose, nothing above the quickstart that a non-technical user must scroll past. Written incrementally from Phase 1, finalized as a Phase 4 gate.

---

## 10. Withings Approval Readiness

Withings restricts integration-phase apps to 10 users; production approval lifts this. There is no published rubric — approval goes through the developer dashboard / partner contact channel — so the strategy is to make every verifiable signal favorable. Build these in from the start rather than retrofitting:

- **Privacy policy page** — the hard requirement. A plain-language page served by the Worker itself at **`wellspring.fit/privacy`** (no GitHub Pages dependency — free-plan Pages needs a public repo, and this works while private, ships versioned with the code, and gives a clean URL for the Withings registration), linked from the landing page and the Withings app registration. It states: what is accessed (named data categories, read-only), what is stored (OAuth tokens only, encrypted at rest; health measurements are never persisted), who can see the data (only the user, through their own AI assistant), how to disconnect and revoke, and a contact email (`hello@wellspring.fit`). Write it honestly and briefly; a short true policy beats a long templated one.
- **Minimal, justified scopes** — request only `user.info,user.metrics,user.activity`, and be ready to state one sentence of justification per scope. Never request a scope "for later."
- **A working, professional OAuth flow** — reviewers may click through it. The landing page → consent → Withings → success-page chain from §9 is exactly what they'll see; make sure the demo-mode path works so a reviewer without a device can complete it.
- **Real disconnection** — implementing the `revoke` endpoint (§9.5) demonstrates lifecycle responsibility, which is the core of what a health-data review is checking.
- **Branding compliance** — describe the app as an *unofficial integration for Withings devices*; do not use the Withings name as the leading word of the app name or their logo as the app icon. The chosen name, **"Wellspring for Withings,"** already complies (verify current branding guidelines at submission time).
- **Open-source repo** — link it in the submission. Auditable code turns every claim in the privacy policy into something a reviewer can verify in minutes.
- **The submission itself** — one tight paragraph: *"A Model Context Protocol server that lets individual users query their own Withings health data through AI assistants such as Claude. Read-only. Each user authorizes their own account via OAuth 2.0. No health data is stored server-side; only OAuth tokens are retained, encrypted at rest. Users can disconnect at any time, which revokes tokens via the revoke endpoint. Open source: [repo URL]. Privacy policy: [URL]."* Attach the connect-page URL so they can experience the flow directly.
- **Timing** — submit after Phase 4. The 10-user cap only counts currently authorized users, so an instance's existing users are never blocked while approval is pending; treat approval as an upgrade, not a gate.

---

## 11. Build Phases

**Phase 0 — Setup (~1–2 hours):** complete `SETUP.local.md` end-to-end (see §0); its exit criteria are this phase's definition of done.

**Phase 1 — Scaffold (~1 session):** create project from Cloudflare's auth-enabled remote MCP template; deploy the unmodified template; connect MCP Inspector and then Claude to confirm the transport + client-facing OAuth work end-to-end *before* any Withings code exists. This isolates the hardest-to-debug layer.

**Phase 2 — Withings OAuth + token DO (~1–2 sessions):** replace the template's upstream provider with Withings (authorize URL, `requesttoken` exchange, nonstandard response parsing); build the request-signature helper (needed by recovery); implement the token DO with coalesced refresh and the three-rung recovery ladder (refresh → `recoverauthorizationcode` → re-auth); implement `/withings/connect` re-auth route; write the six priority tests. This phase is the project — take it slowly.

**Phase 3 — Tools + server instructions (~1 session):** implement the seven tools + normalization helpers (dual units, user-timezone dates) against the demo user, then a real account; write the server `instructions` field and rich tool descriptions.

**Phase 4 — UX & hardening (~1–2 sessions):** landing page, customized consent screen, post-connect success page with a starter prompt; plain-language error pass and empty-state handling; `revoke` on disconnect (reuses the Phase 2 signature helper); privacy policy served at `wellspring.fit/privacy`; log-hygiene audit (grep for any logging of bodies/tokens); rate-limit retry; README with a user-facing quickstart above the developer docs; **flip the repo to public** (per the repo-visibility policy in `SETUP.local.md` — audit passed, README presentable, history clean by construction).

**Phase 5 — Production deploy (~30 min):** CI pipeline, prod secrets, prod Withings redirect URI, connect Claude to prod URL, deauthorize the dev connector.

**Phase 6 — Withings approval submission (~1 hour + wait):** verify demo-mode works end-to-end for a reviewer, confirm branding compliance, submit the §10 paragraph with links via the developer dashboard/contact channel. Existing authorized users stay under the 10-user cap in the meantime, so nothing is blocked while this is pending.

**Phase 7 — Optional later:** Withings webhook/notification subscriptions for freshness; response caching in the DO (sleep data for a past date never changes); ECG waveform retrieval.

Realistic total: a focused weekend plus a couple of evenings, with most of the genuine difficulty concentrated in Phase 2.

---

## 12. Known Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Withings rotates/invalidates tokens server-side | Low | Recovery ladder self-heals most cases silently; 30-second re-auth flow as final fallback |
| Withings approval delayed or requires changes | Moderate — no published rubric | §10 signals built in from day one; 10-user cap keeps existing users unblocked during review; self-hosted instances have no cap at all |
| Cloudflare template APIs drift from this plan | Moderate — verify at build time | Treat template as starting point; the architecture holds regardless of exact API names |
| Withings changes Public API terms or endpoints | Low | Single `withings/client.ts` boundary means changes localize to one module |
| Free-tier changes | Low | Usage is so small that even paid Workers would be ~$5/mo worst case; usage notifications enabled |
| MCP spec evolution (auth requirements have shifted before) | Moderate over years | Agents SDK + oauth-provider absorb spec changes via dependency updates — another reason not to hand-roll the transport |

---

## 13. Definition of Done

The project is complete when: Claude answers "how did I sleep last week compared to my average?" using live data in the user's own timezone and preferred units; two parallel tool calls with an expired token produce exactly one refresh (verified by test); killing the Worker mid-refresh never orphans the token chain (verified by test); a broken refresh chain silently self-heals via `recoverauthorizationcode` before ever bothering the user (verified by test); a `needs_reauth` state presents a working one-click reconnect; a non-technical user can go from the landing page to their first answered health question without help; disconnecting genuinely revokes Withings access; every user-visible error names its one corrective action; the privacy policy is published and linked; the demo-mode flow works end-to-end for a reviewer with no device; the §7 security non-negotiables have been audited end-to-end against the deployed dev environment; secrets exist only in Wrangler/GitHub secret stores; no health data or tokens appear in logs; a merge to `main` deploys with no manual steps; and the Withings approval submission is sent.
