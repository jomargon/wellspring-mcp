// Phase 4 Unit 6: per-IP rate limiting on the auth routes (PLAN.md §7 —
// OAuth endpoints must not be usable for enumeration or abuse).

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

function hit(path: string, ip: string): Promise<Response> {
	return exports.default.fetch(`http://example.com${path}`, {
		headers: { "CF-Connecting-IP": ip },
		redirect: "manual",
	});
}

// Miniflare's rate-limit simulator counts within epoch-aligned 60s windows
// and resets at each boundary, so a burst can straddle two windows. A burst
// of 23 puts at least 12 requests in one window (limit is 10), guaranteeing
// a throttled response wherever the boundary falls.
const BURST = 23;

describe("auth-route rate limiting", () => {
	it("returns 429 after the per-IP limit and leaves other IPs unaffected", async () => {
		const limited: number[] = [];
		for (let i = 0; i < BURST; i++) {
			const response = await hit("/withings/connect", "203.0.113.7");
			limited.push(response.status);
		}
		// First request passes (302 to Withings), the burst gets throttled.
		expect(limited[0]).toBe(302);
		expect(limited).toContain(429);

		const otherIp = await hit("/withings/connect", "203.0.113.99");
		expect(otherIp.status).toBe(302);
	});

	it("serves the 429 as a friendly page with one corrective action", async () => {
		let throttled: Response | undefined;
		for (let i = 0; i < BURST; i++) {
			const response = await hit("/disconnect", "203.0.113.8");
			if (response.status === 429) {
				throttled = response;
				break;
			}
		}
		expect(throttled).toBeDefined();
		if (!throttled) return;
		const html = await throttled.text();
		expect(html.toLowerCase()).toContain("try again");
		expect(html).not.toContain("<script");
	});

	// /register and /token are handled inside OAuthProvider before Hono, so
	// they get their own guard in index.ts — every registration is a KV write
	// and free-tier KV allows 1,000/day.
	it("limits the provider-internal /register endpoint", async () => {
		const statuses: number[] = [];
		let throttled: Response | undefined;
		for (let i = 0; i < BURST; i++) {
			const response = await exports.default.fetch(
				"http://example.com/register",
				{
					method: "POST",
					headers: {
						"CF-Connecting-IP": "203.0.113.10",
						"content-type": "application/json",
					},
					body: "{}",
				},
			);
			statuses.push(response.status);
			throttled ??= response.status === 429 ? response : undefined;
		}
		expect(statuses).toContain(429);
		expect(throttled).toBeDefined();
		if (!throttled) return;
		expect(throttled.headers.get("content-type")).toContain("application/json");
		expect(throttled.headers.get("retry-after")).toBe("60");
		const body = (await throttled.json()) as { error?: string };
		expect(body.error).toBe("temporarily_unavailable");
	});

	// /token is deliberately unlimited: hosted MCP clients call it from shared
	// egress IPs, so a per-IP bucket there throttles legitimate refreshes.
	it("does not limit the /token endpoint", async () => {
		for (let i = 0; i < BURST; i++) {
			const response = await exports.default.fetch("http://example.com/token", {
				method: "POST",
				headers: { "CF-Connecting-IP": "203.0.113.11" },
				body: "",
			});
			expect(response.status).not.toBe(429);
		}
	});

	it("does not limit the public pages", async () => {
		for (let i = 0; i < 15; i++) {
			const response = await hit("/", "203.0.113.9");
			expect(response.status).toBe(200);
		}
	});
});
