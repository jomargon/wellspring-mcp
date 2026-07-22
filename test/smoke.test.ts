import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Phase 1 smoke tests: the Worker boots in the real workerd runtime and the
// client-facing OAuth layer gates the MCP endpoint. No health data, no tokens.
describe("worker smoke", () => {
	it("rejects unauthenticated requests to /mcp", async () => {
		const response = await exports.default.fetch("http://example.com/mcp");
		expect(response.status).toBe(401);
	});

	it("serves OAuth authorization server metadata", async () => {
		const response = await exports.default.fetch(
			"http://example.com/.well-known/oauth-authorization-server",
		);
		expect(response.status).toBe(200);
		const metadata = (await response.json()) as Record<string, unknown>;
		expect(metadata.authorization_endpoint).toContain("/authorize");
		expect(metadata.token_endpoint).toContain("/token");
		expect(metadata.registration_endpoint).toContain("/register");
	});
});
