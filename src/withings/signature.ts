// Withings signature v2 (needed by recoverauthorizationcode, later by revoke).
// Recipe per developer.withings.com/developer-guide/v3/get-access/sign-your-requests:
// sort params alphabetically by key, join their VALUES with commas, HMAC-SHA256
// with the client_secret as key, lowercase hex output.

import { postWithings } from "./client";
import { nonceBodySchema } from "./schemas";

export interface WithingsCredentials {
	clientId: string;
	clientSecret: string;
}

export async function signParams(
	params: Record<string, string>,
	clientSecret: string,
): Promise<string> {
	const joined = Object.keys(params)
		.sort()
		.map((key) => params[key])
		.join(",");
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(clientSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(joined),
	);
	return Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Fetch a fresh nonce (valid 30 minutes, single-use) from Withings.
 * The getnonce request is itself signed over action, client_id, timestamp.
 */
export async function getNonce(
	credentials: WithingsCredentials,
): Promise<string> {
	const params = {
		action: "getnonce",
		client_id: credentials.clientId,
		timestamp: String(Math.floor(Date.now() / 1000)),
	};
	const signature = await signParams(params, credentials.clientSecret);
	const body = await postWithings("/v2/signature", { ...params, signature });
	return nonceBodySchema.parse(body).nonce;
}
