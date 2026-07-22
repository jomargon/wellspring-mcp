// Makes the `cloudflare:test` ambient module (env, runInDurableObject, …)
// visible to tsc. Vitest resolves it at runtime via the pool-workers plugin.
/// <reference types="@cloudflare/vitest-pool-workers/types" />
