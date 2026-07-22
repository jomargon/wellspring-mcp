// The six-priority-test core (PLAN.md §7 tests 1, 2, 3, 6): the token DO's
// refresh ladder, exercised in the real workerd runtime. Withings is mocked at
// the fetch boundary (worker + DOs run in the test isolate, so global fetch
// mocks apply). All token values are synthetic — no real health data, ever.

import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserTokensDO } from "../src/tokens/do";

type RecordedCall = { url: string; params: URLSearchParams };

function withingsJson(status: number, body?: unknown): Response {
	return new Response(JSON.stringify({ status, body }), { status: 200 });
}

function tokenBody(overrides: Record<string, unknown> = {}) {
	return {
		userid: 42,
		access_token: "new-access-token",
		refresh_token: "new-refresh-token",
		expires_in: 10800,
		scope: "user.info,user.metrics,user.activity",
		token_type: "Bearer",
		...overrides,
	};
}

/**
 * Routes mocked Withings calls by `action`/`grant_type` and records each call.
 * Individual tests override per-action behavior.
 */
function mockWithings(handlers: {
	refresh?: (params: URLSearchParams) => Response | Promise<Response>;
	getnonce?: (params: URLSearchParams) => Response;
	recover?: (params: URLSearchParams) => Response;
	exchange?: (params: URLSearchParams) => Response;
}): RecordedCall[] {
	const calls: RecordedCall[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const params = new URLSearchParams(String(init?.body ?? ""));
		calls.push({ url, params });
		const action = params.get("action");
		if (action === "getnonce") {
			return (
				handlers.getnonce ?? (() => withingsJson(0, { nonce: "test-nonce" }))
			)(params);
		}
		if (action === "recoverauthorizationcode") {
			return (
				handlers.recover ??
				(() => withingsJson(0, { user: { code: "recovered-code" } }))
			)(params);
		}
		if (
			action === "requesttoken" &&
			params.get("grant_type") === "refresh_token"
		) {
			return (handlers.refresh ?? (() => withingsJson(0, tokenBody())))(params);
		}
		if (
			action === "requesttoken" &&
			params.get("grant_type") === "authorization_code"
		) {
			return (handlers.exchange ?? (() => withingsJson(0, tokenBody())))(
				params,
			);
		}
		throw new Error(`Unexpected Withings call: ${action}`);
	});
	return calls;
}

let userCounter = 0;
function freshStub() {
	// A unique name per test = a fresh DO instance, no cross-test state.
	const name = `test-user-${++userCounter}`;
	return env.USER_TOKENS.get(env.USER_TOKENS.idFromName(name));
}

// Near-expired: inside the 5-minute proactive-refresh buffer, so the next
// getAccessToken() must refresh. Avoids fake timers entirely.
function nearExpiredRecord(overrides: Record<string, unknown> = {}) {
	return {
		withingsUserId: "42",
		accessToken: "old-access-token",
		refreshToken: "old-refresh-token",
		expiresAt: Date.now() + 60_000,
		scope: "user.info,user.metrics,user.activity",
		redirectUri: "https://example.com/callback",
		...overrides,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("UserTokensDO refresh ladder", () => {
	// Priority test 1: concurrent getAccessToken() calls trigger exactly one
	// upstream refresh.
	it("coalesces concurrent refreshes into one upstream call", async () => {
		const stub = freshStub();
		await stub.setTokens(nearExpiredRecord());

		const calls = mockWithings({
			refresh: async () => {
				// Yield so the other concurrent callers reach the DO while this
				// refresh is in flight (the DO input gate is open during fetch).
				await new Promise((resolve) => setTimeout(resolve, 50));
				return withingsJson(0, tokenBody());
			},
		});

		const results = await Promise.all([
			stub.getAccessToken(),
			stub.getAccessToken(),
			stub.getAccessToken(),
		]);

		expect(
			calls.filter((c) => c.params.get("grant_type") === "refresh_token"),
		).toHaveLength(1);
		for (const result of results) {
			expect(result).toEqual({ ok: true, accessToken: "new-access-token" });
		}
	});

	// Priority test 2: a failed storage write must not hand out the new token
	// and must not orphan the old refresh token.
	it("does not hand out a token the storage write failed to persist", async () => {
		const stub = freshStub();
		await stub.setTokens(nearExpiredRecord());
		const calls = mockWithings({});

		await runInDurableObject(stub, (_instance: UserTokensDO, state) => {
			vi.spyOn(state.storage, "put").mockRejectedValueOnce(
				new Error("disk full"),
			);
		});

		const failed = await stub.getAccessToken();
		expect(failed).toEqual({ ok: false, error: "withings_unavailable" });

		// The old refresh token was not orphaned: the retry refreshes with it.
		const recovered = await stub.getAccessToken();
		expect(recovered).toEqual({ ok: true, accessToken: "new-access-token" });
		const refreshCalls = calls.filter(
			(c) => c.params.get("grant_type") === "refresh_token",
		);
		expect(refreshCalls).toHaveLength(2);
		for (const call of refreshCalls) {
			expect(call.params.get("refresh_token")).toBe("old-refresh-token");
		}
	});

	// Priority test 3a: invalid_grant triggers recoverauthorizationcode and a
	// successful recovery keeps the user connected.
	it("self-heals an invalid_grant via recoverauthorizationcode", async () => {
		const stub = freshStub();
		await stub.setTokens(nearExpiredRecord());

		const calls = mockWithings({
			refresh: () => withingsJson(401),
		});

		const result = await stub.getAccessToken();
		expect(result).toEqual({ ok: true, accessToken: "new-access-token" });
		expect(await stub.getStatus()).toBe("ok");

		const actions = calls.map(
			(c) => `${c.params.get("action")}:${c.params.get("grant_type") ?? ""}`,
		);
		expect(actions).toEqual([
			"requesttoken:refresh_token",
			"getnonce:",
			"recoverauthorizationcode:",
			"requesttoken:authorization_code",
		]);
		// Recovery is a signed request addressed to the right user.
		const recover = calls[2];
		expect(recover?.params.get("userid")).toBe("42");
		expect(recover?.params.get("nonce")).toBe("test-nonce");
		expect(recover?.params.get("signature")).toMatch(/^[0-9a-f]{64}$/);
	});

	// Priority test 3b: only recovery failure flips needs_reauth, and the
	// state then short-circuits without touching Withings.
	it("flips to needs_reauth only when recovery also fails, then short-circuits", async () => {
		const stub = freshStub();
		await stub.setTokens(nearExpiredRecord());

		const calls = mockWithings({
			refresh: () => withingsJson(401),
			recover: () => withingsJson(293),
		});

		const result = await stub.getAccessToken();
		expect(result).toEqual({ ok: false, error: "needs_reauth" });
		expect(await stub.getStatus()).toBe("needs_reauth");

		const callsBefore = calls.length;
		const again = await stub.getAccessToken();
		expect(again).toEqual({ ok: false, error: "needs_reauth" });
		expect(calls.length).toBe(callsBefore); // zero further upstream calls
	});

	// Priority test 6: a recovered token chain resumes normal refresh behavior
	// (no lingering recovery path, no needs_reauth).
	it("resumes normal refresh after a recovery", async () => {
		const stub = freshStub();
		await stub.setTokens(nearExpiredRecord());

		// Recovery hands back a chain that is itself near-expired (expires_in
		// inside the 5-min buffer) so the following call must refresh again.
		mockWithings({
			refresh: () => withingsJson(401),
			exchange: () =>
				withingsJson(
					0,
					tokenBody({
						access_token: "recovered-access-token",
						refresh_token: "recovered-refresh-token",
						expires_in: 60,
					}),
				),
		});
		expect(await stub.getAccessToken()).toEqual({
			ok: true,
			accessToken: "recovered-access-token",
		});

		// Second round: plain refresh with the recovered token.
		vi.restoreAllMocks();
		const secondRound = mockWithings({});
		const result = await stub.getAccessToken();
		expect(result).toEqual({ ok: true, accessToken: "new-access-token" });
		expect(secondRound.map((c) => c.params.get("action"))).toEqual([
			"requesttoken",
		]);
		expect(secondRound[0]?.params.get("grant_type")).toBe("refresh_token");
		expect(secondRound[0]?.params.get("refresh_token")).toBe(
			"recovered-refresh-token",
		);
		expect(await stub.getStatus()).toBe("ok");
	});

	it("transient refresh failure retries once, then reports unavailable without state damage", async () => {
		const stub = freshStub();
		await stub.setTokens(nearExpiredRecord());

		const calls = mockWithings({
			refresh: () => withingsJson(601), // rate limited — transient
		});

		const result = await stub.getAccessToken();
		expect(result).toEqual({ ok: false, error: "withings_unavailable" });
		expect(calls).toHaveLength(2); // one retry, no recovery attempt
		expect(await stub.getStatus()).toBe("ok"); // not flipped to needs_reauth
	});

	it("reports not_connected before any tokens exist", async () => {
		const stub = freshStub();
		expect(await stub.getStatus()).toBe("not_connected");
		expect(await stub.getAccessToken()).toEqual({
			ok: false,
			error: "needs_reauth",
		});
	});

	it("returns the stored token untouched while it is fresh", async () => {
		const stub = freshStub();
		await stub.setTokens(
			nearExpiredRecord({ expiresAt: Date.now() + 60 * 60_000 }),
		);
		const calls = mockWithings({});
		expect(await stub.getAccessToken()).toEqual({
			ok: true,
			accessToken: "old-access-token",
		});
		expect(calls).toHaveLength(0);
	});
});
