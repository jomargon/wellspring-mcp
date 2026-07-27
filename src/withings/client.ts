import { WithingsApiError } from "../errors";
import { withingsEnvelopeSchema } from "./schemas";

export const WITHINGS_API_BASE = "https://wbsapi.withings.net";

const DEFAULT_TIMEOUT_MS = 10_000;

// Withings 601 = "too many requests" (~120/min cap). One retry with backoff
// (PLAN.md §4). RATE_LIMITED_STATUS requests were never processed upstream,
// so retrying is safe even for requesttoken — the single-use refresh token
// was not consumed.
const RATE_LIMITED_STATUS = 601;
const DEFAULT_RETRY_DELAY_MS = 1_000;

// Withings status codes meaning "your credential/token is bad" (docs: 100–102
// and 200 are "Authentication failed"; 401 appears for invalid or expired
// tokens). A data call failing with one of these means the access token
// itself was rejected — the trigger for the dead-token report in
// tools/shared.ts. Deliberately excludes 342/343 (signature/nonce problems):
// those signal a signing bug, not a dead token, and must not force refreshes.
export const TOKEN_REJECTED_STATUSES: ReadonlySet<number> = new Set([
	100, 101, 102, 200, 401,
]);

// The rejected statuses plus the token-endpoint signature codes. These — or
// an error string mentioning invalid_grant — are the only trigger for the
// recovery ladder's rung 2. Every other non-zero status is treated as
// transient so an unknown code can never lock a user into needs_reauth.
const INVALID_GRANT_STATUSES = new Set([...TOKEN_REJECTED_STATUSES, 342, 343]);

/**
 * POST to a Withings endpoint and return the parsed `body` payload.
 *
 * Enforces the project-wide rule in one place: HTTP 200 with `status !== 0`
 * is an ERROR. Throws WithingsApiError classified as "invalid_grant" or
 * "transient" — never containing response bodies or tokens (log hygiene).
 * A 601 (rate limited) is retried exactly once after a short jittered delay;
 * a second 601 surfaces as transient.
 */
export async function postWithings(
	path: string,
	params: Record<string, string>,
	options: {
		timeoutMs?: number;
		accessToken?: string;
		retryDelayMs?: number;
	} = {},
): Promise<unknown> {
	try {
		return await attemptWithings(path, params, options);
	} catch (error) {
		if (
			error instanceof WithingsApiError &&
			error.withingsStatus === RATE_LIMITED_STATUS
		) {
			const delay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
			// Proportional jitter so concurrent callers don't retry in lockstep
			// (and a 0ms test delay stays 0ms).
			await sleep(delay * (1 + Math.random() * 0.25));
			return attemptWithings(path, params, options);
		}
		throw error;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptWithings(
	path: string,
	params: Record<string, string>,
	options: { timeoutMs?: number; accessToken?: string } = {},
): Promise<unknown> {
	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
	};
	if (options.accessToken) {
		headers.Authorization = `Bearer ${options.accessToken}`;
	}
	let response: Response;
	try {
		response = await fetch(`${WITHINGS_API_BASE}${path}`, {
			method: "POST",
			headers,
			body: new URLSearchParams(params).toString(),
			signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});
	} catch (_error) {
		// Network failure or timeout — no response to classify.
		throw new WithingsApiError("transient");
	}

	let envelope: ReturnType<typeof withingsEnvelopeSchema.parse>;
	try {
		envelope = withingsEnvelopeSchema.parse(await response.json());
	} catch (_error) {
		throw new WithingsApiError("transient");
	}

	if (envelope.status !== 0) {
		const isInvalidGrant =
			INVALID_GRANT_STATUSES.has(envelope.status) ||
			(envelope.error?.includes("invalid_grant") ?? false);
		throw new WithingsApiError(
			isInvalidGrant ? "invalid_grant" : "transient",
			envelope.status,
		);
	}

	return envelope.body;
}
