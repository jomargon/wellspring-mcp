// Phase 4 Unit 5: self-service disconnect (amended PLAN.md §9.5). The user
// re-proves account ownership via the Withings OAuth hop; the callback then
// revokes Withings-side, clears the token DO, and revokes client grants.
// All token values synthetic — no real health data, ever.

import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

type RecordedCall = { url: string; params: URLSearchParams };

function withingsJson(status: number, body?: unknown): Response {
	return new Response(JSON.stringify({ status, body }), { status: 200 });
}

function tokenBody(userid: number) {
	return {
		userid,
		access_token: "synthetic-access-token",
		refresh_token: "synthetic-refresh-token",
		expires_in: 10800,
		scope: "user.info,user.metrics,user.activity",
		token_type: "Bearer",
	};
}

/** Routes mocked Withings calls by `action` and records each call. */
function mockWithings(
	userid: number,
	handlers: { revoke?: (params: URLSearchParams) => Response } = {},
): RecordedCall[] {
	const calls: RecordedCall[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const params = new URLSearchParams(String(init?.body ?? ""));
		calls.push({ url, params });
		const action = params.get("action");
		if (action === "getnonce") return withingsJson(0, { nonce: "test-nonce" });
		if (action === "requesttoken") return withingsJson(0, tokenBody(userid));
		if (action === "revoke") {
			return (handlers.revoke ?? (() => withingsJson(0, {})))(params);
		}
		throw new Error(`Unexpected Withings call: ${action}`);
	});
	return calls;
}

let userCounter = 100;

async function seedTokens(withingsUserId: string) {
	const stub = env.USER_TOKENS.get(env.USER_TOKENS.idFromName(withingsUserId));
	await stub.setTokens({
		withingsUserId,
		accessToken: "synthetic-access-token",
		refreshToken: "synthetic-refresh-token",
		expiresAt: Date.now() + 60 * 60_000,
		scope: "user.info,user.metrics,user.activity",
		redirectUri: "https://example.com/withings/callback",
	});
	return stub;
}

/**
 * Drive the real flow: /disconnect/start issues the state + session cookie,
 * then the Withings callback completes the disconnect.
 */
async function runDisconnectCallback(): Promise<Response> {
	// redirect: "manual" — otherwise the test fetcher follows the 302 to the
	// Withings authorize URL and re-enters this worker as a 404.
	const start = await exports.default.fetch(
		"http://example.com/disconnect/start",
		{ redirect: "manual" },
	);
	expect(start.status).toBe(302);
	const location = new URL(start.headers.get("Location") ?? "");
	const state = location.searchParams.get("state");
	expect(state).toBeTruthy();
	const cookies = start.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");

	return exports.default.fetch(
		`http://example.com/withings/callback?code=synthetic-code&state=${state}`,
		{ headers: { Cookie: cookies } },
	);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("GET /disconnect", () => {
	it("shows a confirmation page that explains and links the start route", async () => {
		const response = await exports.default.fetch(
			"http://example.com/disconnect",
		);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('href="/disconnect/start"');
		expect(html.toLowerCase()).toContain("revoke");
		expect(html).not.toContain("<script");
	});
});

describe("disconnect flow", () => {
	it("revokes Withings access with a signed request and clears the token DO", async () => {
		const userid = ++userCounter;
		const stub = await seedTokens(String(userid));
		const calls = mockWithings(userid);

		const response = await runDisconnectCallback();
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html.toLowerCase()).toContain("disconnected");

		const revokeCall = calls.find((c) => c.params.get("action") === "revoke");
		expect(revokeCall).toBeDefined();
		expect(revokeCall?.params.get("userid")).toBe(String(userid));
		expect(revokeCall?.params.get("nonce")).toBe("test-nonce");
		expect(revokeCall?.params.get("signature")).toMatch(/^[0-9a-f]{64}$/);

		expect(await stub.getStatus()).toBe("not_connected");
	});

	it("still clears local tokens when the Withings revoke call fails", async () => {
		const userid = ++userCounter;
		const stub = await seedTokens(String(userid));
		mockWithings(userid, { revoke: () => withingsJson(503) });

		const response = await runDisconnectCallback();
		expect(response.status).toBe(200);
		const html = await response.text();
		// Honest partial-success: point at the Withings account page as the
		// manual revoke path.
		expect(html).toContain("account.withings.com");

		expect(await stub.getStatus()).toBe("not_connected");
	});
});
