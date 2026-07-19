# Wellspring for Withings (`wellspring-mcp`)

Remote MCP server on Cloudflare Workers that lets Claude read a user's Withings
sleep, body, activity, and heart data. Read-only. Zero-cost infrastructure.

## Before any work

**Read `PLAN.md` in full.** It is the project's source of truth — architecture,
phases, security requirements, and acceptance criteria all live there, and its
preamble contains your standing instructions. If code and PLAN.md disagree, flag
it; don't silently diverge.

**Current phase: 0** (pre-development setup — human-only tasks in the untracked
`SETUP.local.md`; ask the developer to confirm its exit criteria are met before
scaffolding. If that file is absent, setup steps live outside the repo.)

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
- Verify current library APIs / template names against live docs before use;
  fetch Withings' one-file AI context from developer.withings.com rather than
  guessing endpoint details.

## Commands

(Fill in during Phase 1 once the project is scaffolded: dev server, test,
typecheck/lint, deploy.)

## Maintaining this file

Keep it short — it loads into every session. Update the phase number as the
project advances. Append conventions here when they're discovered the hard way;
move anything spec-like into PLAN.md instead.
