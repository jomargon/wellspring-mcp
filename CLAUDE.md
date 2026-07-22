# Wellspring for Withings (`wellspring-mcp`)

Remote MCP server on Cloudflare Workers that lets Claude read a user's Withings
sleep, body, activity, and heart data. Read-only. Zero-cost infrastructure.

## Before any work

**Read `PLAN.md` in full.** It is the project's source of truth — architecture,
phases, security requirements, and acceptance criteria all live there, and its
preamble contains your standing instructions. If code and PLAN.md disagree, flag
it; don't silently diverge.

**Current phase: 1** (scaffold deployed to
`wellspring-mcp-dev.jomargon.workers.dev`; Phase 1 completes when the developer
finishes the end-to-end OAuth verification — throwaway GitHub OAuth app +
GITHUB_* secrets, then MCP Inspector and Claude connect. Then bump to 2.)

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
- Small modules per PLAN.md §7; one tool per file; shared normalization helpers
  (dual units, user-timezone dates) — never inline unit math in tools.
- Errors surfaced to users map to exactly one of: `needs_reauth`,
  `withings_unavailable`, `invalid_request` — plain language, one corrective
  action, no raw upstream errors.
- Tests run in the real Workers runtime via `@cloudflare/vitest-pool-workers`;
  Withings is mocked with `fetchMock`. The six priority tests in §7 gate Phase 2.
- Git workflow: **the developer personally handles all git operations** —
  do not commit, push, branch, or open PRs unless explicitly asked in the
  moment. Leave changes in the working tree for the developer to review and
  commit. (Project rule for reference: nothing goes directly to `main`;
  branch + PR, one per coherent unit of work.)
- Verify current library APIs / template names against live docs before use;
  fetch Withings' one-file AI context from developer.withings.com rather than
  guessing endpoint details.

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
