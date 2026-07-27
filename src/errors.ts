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

// User-visible category messages (PLAN.md §6/§7: plain language, one
// corrective action, no upstream jargon). Centralized here so the wording is
// reviewed in one place; tool-specific notes stay at their call sites.

/** No withingsUserId in props — the client-facing grant is broken. */
export function notLinkedMessage(): string {
	return (
		"No Withings account is linked to this session. Reconnect the " +
		"Wellspring connector in your AI assistant's settings to start over."
	);
}

/** The shared reconnect instruction, so the wording lives in one place. */
function reconnectInstruction(reconnectUrl: string): string {
	return `open ${reconnectUrl}. It takes about 30 seconds.`;
}

/** Recovery ladder exhausted — the one-click re-auth link is the fix. */
export function reauthMessage(reconnectUrl: string): string {
	return (
		"The Withings connection needs a quick one-click reconnect. Ask the " +
		`user to ${reconnectInstruction(reconnectUrl)}`
	);
}

/**
 * Withings rejected the credentials mid-call. One corrective action: the
 * reconnect link always works, whether or not the silent self-heal (the
 * dead-token report to the DO) already fixed things for the next call.
 */
export function rejectedMessage(reconnectUrl: string): string {
	return (
		"Withings rejected this connection. To reconnect, " +
		reconnectInstruction(reconnectUrl)
	);
}

/** Transient upstream failure — retry is the only action. */
export function unavailableMessage(): string {
	return "Withings didn't respond just now. Please try again in a minute.";
}

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
