import { WithingsApiError } from "../errors";
import { withingsEnvelopeSchema } from "./schemas";

export const WITHINGS_API_BASE = "https://wbsapi.withings.net";

const DEFAULT_TIMEOUT_MS = 10_000;

// Withings status codes meaning "your credential/token is bad" (docs: 100–102
// and 200 are "Authentication failed"; 401/342/343 appear on the token
// endpoints for invalid or expired grants). These — or an error string
// mentioning invalid_grant — are the only trigger for the recovery ladder's
// rung 2. Every other non-zero status is treated as transient so an unknown
// code can never lock a user into needs_reauth.
const INVALID_GRANT_STATUSES = new Set([100, 101, 102, 200, 401, 342, 343]);

/**
 * POST to a Withings endpoint and return the parsed `body` payload.
 *
 * Enforces the project-wide rule in one place: HTTP 200 with `status !== 0`
 * is an ERROR. Throws WithingsApiError classified as "invalid_grant" or
 * "transient" — never containing response bodies or tokens (log hygiene).
 */
export async function postWithings(
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
