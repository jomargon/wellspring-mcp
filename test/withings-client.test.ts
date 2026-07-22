import { afterEach, describe, expect, it, vi } from "vitest";
import { WithingsApiError } from "../src/errors";
import { postWithings } from "../src/withings/client";
import { signParams } from "../src/withings/signature";

function mockWithingsResponse(json: unknown) {
	return vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(new Response(JSON.stringify(json), { status: 200 }));
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("postWithings envelope handling", () => {
	// Priority test 4 (PLAN.md §7): HTTP 200 with status != 0 is an ERROR.
	it("treats HTTP 200 with status != 0 as an error", async () => {
		mockWithingsResponse({ status: 503, body: {} });
		const error = await postWithings("/v2/oauth2", {}).catch((e) => e);
		expect(error).toBeInstanceOf(WithingsApiError);
		expect((error as WithingsApiError).kind).toBe("transient");
		expect((error as WithingsApiError).withingsStatus).toBe(503);
	});

	it("classifies authentication-failed statuses as invalid_grant", async () => {
		for (const status of [100, 200, 401]) {
			vi.restoreAllMocks();
			mockWithingsResponse({ status, body: {} });
			const error = await postWithings("/v2/oauth2", {}).catch((e) => e);
			expect((error as WithingsApiError).kind).toBe("invalid_grant");
		}
	});

	it("classifies an invalid_grant error string as invalid_grant", async () => {
		mockWithingsResponse({ status: 999, error: "invalid_grant: bad token" });
		const error = await postWithings("/v2/oauth2", {}).catch((e) => e);
		expect((error as WithingsApiError).kind).toBe("invalid_grant");
	});

	it("returns the body payload on status 0", async () => {
		mockWithingsResponse({ status: 0, body: { nonce: "abc" } });
		await expect(postWithings("/v2/signature", {})).resolves.toEqual({
			nonce: "abc",
		});
	});

	it("classifies network failure as transient", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new TypeError("fetch failed"),
		);
		const error = await postWithings("/v2/oauth2", {}).catch((e) => e);
		expect((error as WithingsApiError).kind).toBe("transient");
		expect((error as WithingsApiError).withingsStatus).toBeUndefined();
	});

	it("classifies a non-JSON response as transient", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("<html>maintenance</html>", { status: 200 }),
		);
		const error = await postWithings("/v2/oauth2", {}).catch((e) => e);
		expect((error as WithingsApiError).kind).toBe("transient");
	});

	it("sends params form-encoded", async () => {
		const spy = mockWithingsResponse({ status: 0, body: {} });
		await postWithings("/v2/oauth2", { action: "requesttoken", code: "x" });
		const [url, init] = spy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://wbsapi.withings.net/v2/oauth2");
		expect(init.body).toBe("action=requesttoken&code=x");
	});
});

describe("signature v2", () => {
	// Vectors computed independently (Python hmac) from the documented recipe:
	// values of alphabetically-sorted keys, comma-joined, HMAC-SHA256, hex.
	it("signs getnonce params per the documented recipe", async () => {
		const signature = await signParams(
			{
				action: "getnonce",
				client_id: "test_client_id",
				timestamp: "1700000000",
			},
			"test_client_secret",
		);
		expect(signature).toBe(
			"496df8970fd645edd50468d0de7446cf83fc931d4dfa441ab36bf4c76425477a",
		);
	});

	it("sorts by key name regardless of insertion order", async () => {
		const signature = await signParams(
			{
				nonce: "test-nonce",
				action: "recoverauthorizationcode",
				client_id: "test_client_id",
			},
			"test_client_secret",
		);
		expect(signature).toBe(
			"60dfbca3dfeb979e7f0c1066cb7fa869c21ea55b46db3e0cc8ec0f8a55b525ce",
		);
	});
});
