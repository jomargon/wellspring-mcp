# Wellspring for Withings (`wellspring-mcp`)

Remote MCP server on Cloudflare Workers that lets Claude read a user's Withings
sleep, body, activity, and heart data. Read-only. Zero-cost infrastructure.

## Before any work

**Read `PLAN.md` in full.** It is the project's source of truth — architecture,
phases, security requirements, and acceptance criteria all live there, and its
preamble contains your standing instructions. If code and PLAN.md disagree, flag
it; don't silently diverge.

**Current phase: 5** (production deploy — see PLAN.md §11. Phase 4 landed
2026-07-24: 84 tests green; pages + security headers + disconnect/revoke +
601 retry + rate limiting live on the dev worker; audit probes passed; E2E in
Claude verified. Phase 5 scope: GitHub Actions CI (typecheck/lint/test on PR,
`wrangler deploy` on merge via a Workers-scoped API token), create the prod
KV namespace and replace the placeholder id in `wrangler.jsonc`
`env.production`, prod secrets via `wrangler secret put -e production`, prod
Withings app redirect URI (`https://wellspring.fit/withings/callback`),
connect the prod URL, deauthorize the dev connector. Still pending from
Phase 4, developer-only: repo flip to public plus GitHub secret scanning and
push protection (enable Dependabot while private; secret scanning becomes
free only once public). User-facing copy stays client-neutral (any remote-MCP
assistant) and free of em dashes / AI-sounding phrasing (developer
preference). Rung 2 of the recovery ladder is mock-tested only — a live
`withings_token_recovery` log event is expected ~never; investigate if the
counter climbs.)

## Invariants — never violate, even in a "quick fix"

- No secrets in code, config, fixtures, or commits. Secrets live only in
  `.dev.vars` (gitignored) and Wrangler/GitHub secret stores.
- No health data is ever persisted or logged. No real health data in tests.
- Logging is allowlist-only: tool name, latency, error category, hashed user ID.
  Never request/response bodies, never tokens.
- All Withings token refresh goes through the per-user Durable Object's single
  code path (coalesced, write-before-use). Never add a second writer, cron, or
  bypass. This is the load-bearing design of the whole project (PLAN.md §5).
- Treat the repo as public from the first commit, even while it's private.
- PLAN.md §7 security non-negotiables and §13 Definition of Done are acceptance
  criteria, not suggestions.

## Conventions

- TypeScript strict (`strict`, `noUncheckedIndexedAccess`); no `any` at the
  Withings boundary — zod schemas produce the types, both directions.
- Withings responses: HTTP 200 with `status != 0` in the body is an ERROR.
  Always check the `status` field. Payloads nest under `body`.
- The Withings API serves only data recorded by Withings devices. Data
  imported into the Withings app from other sources (e.g. Apple Health) shows
  in the app but never through the API — an empty result with a healthy
  connection and no capable device is correct behavior, not a bug.
- Small modules per PLAN.md §7; one tool per file; shared normalization helpers
  (dual units, user-timezone dates) — never inline unit math in tools.
- Errors surfaced to users map to exactly one of: `needs_reauth`,
  `withings_unavailable`, `invalid_request` — plain language, one corrective
  action, no raw upstream errors.
- Tests run in the real Workers runtime via `@cloudflare/vitest-pool-workers`;
  Withings is mocked with `vi.spyOn(globalThis, "fetch")` (`fetchMock` no
  longer exists in current vitest-pool-workers; worker + DOs run in the test
  isolate so global mocks reach them — production code must call bare
  `fetch(...)`, never capture it at module scope). The six priority tests in
  §7 gate Phase 2.
- Git workflow: **the developer personally handles all git operations** —
  do not commit, push, branch, or open PRs unless explicitly asked in the
  moment. Leave changes in the working tree for the developer to review and
  commit. (Project rule for reference: nothing goes directly to `main`;
  branch + PR, one per coherent unit of work.)
- Verify current library APIs / template names against live docs before use;
  never guess Withings endpoint details — the full OpenAPI spec downloads
  directly from `https://developer.withings.com/openapi.yaml` (llms.md is the
  fallback but omits signed/partner endpoints).
- Withings exact-matches the registered redirect URI (host + path — ours is
  `/withings/callback`, one URL per app registration), so the OAuth hop can
  only be verified against the deployed dev worker, never `localhost`.
- In tests, `exports.default.fetch` follows redirects by default — a 302 to
  the Withings authorize URL re-enters the worker and surfaces as a Hono 404.
  Pass `redirect: "manual"` when asserting redirects.
- The `AUTH_RATE_LIMIT` binding is best-effort per Cloudflare isolate/colo: a
  small live burst may not trip it (counters are split across isolates); a
  sustained burst does. Miniflare simulates it with epoch-aligned 60s windows
  that reset at each boundary, so a test burst can straddle two windows and
  never trip the limit (flaked in CI once). Rate-limit tests must use a burst
  of ≥ 2×limit+3 and assert "contains a 429", never "the Nth request is 429".

## Commands

- `npm run dev` — local dev server (`wrangler dev`, port 8788)
- `npm test` — Vitest in the real Workers runtime (`cloudflareTest()` plugin;
  note `defineWorkersConfig` is removed in current vitest-pool-workers)
- `npm run type-check` — `tsc --noEmit` (strict + `noUncheckedIndexedAccess`)
- `npm run lint` / `npm run format` — Biome
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` after any
  `wrangler.jsonc` or `.dev.vars` change (runtime + Env types come from it;
  `@cloudflare/workers-types` is deliberately not installed)
- `npm run deploy` — deploy the dev Worker (production deploys are Phase 5)

## Maintaining this file

Keep it short — it loads into every session. Update the phase number as the
project advances. Append conventions here when they're discovered the hard way;
move anything spec-like into PLAN.md instead.
