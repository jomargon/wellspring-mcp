// Upstream OAuth against Withings: authorize URL, code exchange, refresh,
// and server-side authorization-code recovery (rung 2 of the ladder).

import { postWithings } from "./client";
import { recoverBodySchema, tokenBodySchema } from "./schemas";
import { getNonce, signParams, type WithingsCredentials } from "./signature";

export const WITHINGS_AUTHORIZE_URL =
	"https://account.withings.com/oauth2_user/authorize2";

// All three scopes at first authorization — adding scopes later forces
// re-consent (PLAN.md §4).
export const WITHINGS_SCOPES = "user.info,user.metrics,user.activity";

// Normalized result of any token grant. expiresAt is epoch ms.
export interface TokenSet {
	withingsUserId: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	scope: string;
}

export function buildAuthorizeUrl(options: {
	clientId: string;
	redirectUri: string;
	state: string;
	demo?: boolean;
}): string {
	const url = new URL(WITHINGS_AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", options.clientId);
	url.searchParams.set("redirect_uri", options.redirectUri);
	url.searchParams.set("scope", WITHINGS_SCOPES);
	url.searchParams.set("state", options.state);
	if (options.demo) url.searchParams.set("mode", "demo");
	return url.href;
}

/** Exchange an authorization code (30-second lifetime — call immediately). */
export async function exchangeCode(
	credentials: WithingsCredentials,
	code: string,
	redirectUri: string,
): Promise<TokenSet> {
	const body = await postWithings("/v2/oauth2", {
		action: "requesttoken",
		grant_type: "authorization_code",
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
		code,
		redirect_uri: redirectUri,
	});
	return toTokenSet(body);
}

/** Refresh with a (single-use, rotating) refresh token. */
export async function refreshTokens(
	credentials: WithingsCredentials,
	refreshToken: string,
): Promise<TokenSet> {
	const body = await postWithings("/v2/oauth2", {
		action: "requesttoken",
		grant_type: "refresh_token",
		client_id: credentials.clientId,
		client_secret: credentials.clientSecret,
		refresh_token: refreshToken,
	});
	return toTokenSet(body);
}

/**
 * Server-side recovery: Withings issues a fresh authorization code without
 * user involvement. Signed request (action, client_id, nonce). The returned
 * code expires in 30 seconds — exchange it immediately.
 */
export async function recoverAuthorizationCode(
	credentials: WithingsCredentials,
	withingsUserId: string,
): Promise<string> {
	const nonce = await getNonce(credentials);
	const signedParams = {
		action: "recoverauthorizationcode",
		client_id: credentials.clientId,
		nonce,
	};
	const signature = await signParams(signedParams, credentials.clientSecret);
	const body = await postWithings("/v2/oauth2", {
		...signedParams,
		signature,
		userid: withingsUserId,
	});
	return recoverBodySchema.parse(body).user.code;
}

function toTokenSet(body: unknown): TokenSet {
	const parsed = tokenBodySchema.parse(body);
	return {
		withingsUserId: parsed.userid,
		accessToken: parsed.access_token,
		refreshToken: parsed.refresh_token,
		expiresAt: Date.now() + parsed.expires_in * 1000,
		scope: parsed.scope ?? WITHINGS_SCOPES,
	};
}
