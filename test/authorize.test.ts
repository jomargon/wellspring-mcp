// Hardening regressions on GET /authorize: PKCE is required (PLAN.md §7),
// and a corrupted long-lived approval cookie must degrade to "not approved",
// never to a 500 that persists for the cookie's 30-day lifetime.

import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Registered once for the whole file (beforeAll storage survives the
// per-test isolation rollback). Dynamic registration is the only way to a
// clientId that parseAuthRequest accepts.
let clientId: string;

beforeAll(async () => {
	const response = await exports.default.fetch("http://example.com/register", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"CF-Connecting-IP": "203.0.113.21",
		},
		body: JSON.stringify({
			client_name: "Hardening Test Client",
			redirect_uris: ["https://example.com/callback"],
			token_endpoint_auth_method: "none",
		}),
	});
	({ client_id: clientId } = (await response.json()) as { client_id: string });
});

function authorizeUrl(pkce: "full" | "method-only" | "none"): string {
	const url = new URL("http://example.com/authorize");
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", "https://example.com/callback");
	url.searchParams.set("state", "client-state");
	if (pkce !== "none") {
		url.searchParams.set("code_challenge_method", "S256");
	}
	if (pkce === "full") {
		url.searchParams.set("code_challenge", "a".repeat(43));
	}
	return url.href;
}

function get(url: string, extraHeaders: Record<string, string> = {}) {
	return exports.default.fetch(url, {
		headers: { "CF-Connecting-IP": "203.0.113.20", ...extraHeaders },
		redirect: "manual",
	});
}

describe("GET /authorize hardening", () => {
	// With allowPlainPKCE: false the provider rejects a missing challenge at
	// parse time (the method defaults to "plain"), so this path 400s before
	// our handler check.
	it("rejects authorization requests without any PKCE parameters", async () => {
		const response = await get(authorizeUrl("none"));
		expect(response.status).toBe(400);
	});

	// The parse-time rejection doesn't cover method=S256 with no actual
	// challenge; the explicit handler check does.
	it("rejects an S256 request that omits the code challenge", async () => {
		const response = await get(authorizeUrl("method-only"));
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("PKCE");
	});

	it("accepts a PKCE request and renders the approval dialog", async () => {
		const response = await get(authorizeUrl("full"));
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("Wellspring for Withings");
	});

	// Non-Latin1 characters in client-supplied form state must not 500: the
	// approval cookie encode is UTF-8-safe end to end.
	it("handles unicode client metadata in the approval form without failing", async () => {
		const dialog = await get(authorizeUrl("full"));
		const csrfCookie = dialog.headers.get("set-cookie") ?? "";
		const csrfToken =
			/name="csrf_token" value="([^"]+)"/.exec(await dialog.text())?.[1] ?? "";
		const forgedState = btoa(
			String.fromCharCode(
				...new TextEncoder().encode(
					JSON.stringify({
						oauthReqInfo: {
							clientId: "client-ÿ中",
							codeChallenge: "a".repeat(43),
						},
					}),
				),
			),
		);

		const response = await exports.default.fetch(
			"http://example.com/authorize",
			{
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					"CF-Connecting-IP": "203.0.113.20",
					Cookie: csrfCookie.split(";")[0] ?? "",
				},
				body: new URLSearchParams({
					csrf_token: csrfToken,
					state: forgedState,
				}).toString(),
				redirect: "manual",
			},
		);
		expect(response.status).not.toBe(500);
	});

	// A stale approval form (expired or already-used CSRF cookie, e.g. the
	// browser back button after approving) must show a plain-language page,
	// never raw JSON.
	it("shows a styled page when the approval form is stale", async () => {
		const response = await exports.default.fetch(
			"http://example.com/authorize",
			{
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					"CF-Connecting-IP": "203.0.113.22",
				},
				body: "csrf_token=stale-token&state=whatever",
			},
		);
		expect(response.status).toBe(400);
		const html = await response.text();
		expect(html).toContain("start the connection again");
		expect(html).not.toContain('"error"');
	});

	it("treats a corrupted approval cookie as not approved instead of failing", async () => {
		const response = await get(authorizeUrl("full"), {
			Cookie: "__Host-APPROVED_CLIENTS=deadbeef.%%%not-base64%%%",
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("requesting access");
	});
});
