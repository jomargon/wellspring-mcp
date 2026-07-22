// The three user-visible error categories (PLAN.md §7). Everything internal
// maps to exactly one of these; raw Withings errors never reach chat.
export type ErrorCategory =
	| "needs_reauth"
	| "withings_unavailable"
	| "invalid_request";

// RPC-safe result for UserTokensDO.getAccessToken(): discriminated union
// instead of thrown errors, so callers across the DO boundary always get a
// structured value that maps 1:1 onto the error taxonomy.
export type TokenResult =
	| { ok: true; accessToken: string }
	| { ok: false; error: "needs_reauth" | "withings_unavailable" };

export type AuthState = "ok" | "needs_reauth";

export type ConnectionStatus = "ok" | "needs_reauth" | "not_connected";

// Internal classification of a Withings call failure, produced by
// withings/client.ts and consumed by the token DO's recovery ladder.
export type WithingsFailureKind =
	| "invalid_grant" // credentials/token rejected — rung 2 (recovery) territory
	| "transient"; // network/timeout/rate-limit/5xx-ish — retry territory

export class WithingsApiError extends Error {
	constructor(
		public kind: WithingsFailureKind,
		// Withings numeric status when the API answered, undefined on
		// network/timeout/parse failures. Safe to log (allowlist: no bodies).
		public withingsStatus?: number,
	) {
		super(
			`withings_api_error:${kind}${withingsStatus !== undefined ? `:${withingsStatus}` : ""}`,
		);
		this.name = "WithingsApiError";
	}
}
