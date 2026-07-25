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

describe("auth-route rate limiting", () => {
	it("returns 429 after the per-IP limit and leaves other IPs unaffected", async () => {
		const limited: number[] = [];
		for (let i = 0; i < 12; i++) {
			const response = await hit("/withings/connect", "203.0.113.7");
			limited.push(response.status);
		}
		// First requests pass (302 to Withings), the tail is throttled.
		expect(limited[0]).toBe(302);
		expect(limited[limited.length - 1]).toBe(429);

		const otherIp = await hit("/withings/connect", "203.0.113.99");
		expect(otherIp.status).toBe(302);
	});

	it("serves the 429 as a friendly page with one corrective action", async () => {
		for (let i = 0; i < 12; i++) {
			await hit("/disconnect", "203.0.113.8");
		}
		const response = await hit("/disconnect", "203.0.113.8");
		expect(response.status).toBe(429);
		const html = await response.text();
		expect(html.toLowerCase()).toContain("try again");
		expect(html).not.toContain("<script");
	});

	it("does not limit the public pages", async () => {
		for (let i = 0; i < 15; i++) {
			const response = await hit("/", "203.0.113.9");
			expect(response.status).toBe(200);
		}
	});
});
