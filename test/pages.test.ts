import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	htmlResponse,
	layout,
	STYLES,
	stylesResponse,
} from "../src/pages/layout";

// Phase 4 Unit 1: shared page layout, global security headers, CSP without
// 'unsafe-inline'. No health data anywhere in these tests.

const EXPECTED_CSP =
	"default-src 'none'; style-src 'self'; form-action 'self' https://account.withings.com; base-uri 'none'; frame-ancestors 'none'";

function expectGlobalHeaders(response: Response) {
	expect(response.headers.get("Strict-Transport-Security")).toBe(
		"max-age=31536000; includeSubDomains",
	);
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

async function registerClient(): Promise<string> {
	const response = await exports.default.fetch("http://example.com/register", {
		body: JSON.stringify({
			client_name: "Test Client",
			redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
			token_endpoint_auth_method: "none",
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	expect(response.status).toBe(201);
	const body = (await response.json()) as { client_id: string };
	return body.client_id;
}

describe("layout module", () => {
	it("layout links the shared stylesheet and contains no inline style or script", () => {
		const html = layout("Test Title", "<p>hello</p>");
		expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
		expect(html).toContain("<p>hello</p>");
		expect(html).toContain("Test Title");
		expect(html).not.toContain("<style");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onclick");
	});

	it("htmlResponse sets the strict CSP, frame denial, and no-store", () => {
		const response = htmlResponse(layout("T", "<p>x</p>"), 200);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expect(response.headers.get("Content-Security-Policy")).toBe(EXPECTED_CSP);
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});

	it("htmlResponse appends cookies", () => {
		const response = htmlResponse("<p>x</p>", 200, ["a=1; Path=/"]);
		expect(response.headers.get("Set-Cookie")).toBe("a=1; Path=/");
	});

	it("stylesResponse serves CSS with long cache", () => {
		const response = stylesResponse();
		expect(response.headers.get("Content-Type")).toBe(
			"text/css; charset=utf-8",
		);
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
		expect(STYLES).toContain(".card");
	});
});

describe("GET /styles.css", () => {
	it("serves the shared stylesheet with global security headers", async () => {
		const response = await exports.default.fetch(
			"http://example.com/styles.css",
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(
			"text/css; charset=utf-8",
		);
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
		expectGlobalHeaders(response);
	});
});

describe("global security headers", () => {
	it("cover OAuth provider routes (/.well-known metadata)", async () => {
		const response = await exports.default.fetch(
			"http://example.com/.well-known/oauth-authorization-server",
		);
		expect(response.status).toBe(200);
		expectGlobalHeaders(response);
	});

	it("cover the 401 from /mcp", async () => {
		const response = await exports.default.fetch("http://example.com/mcp");
		expect(response.status).toBe(401);
		expectGlobalHeaders(response);
	});

	it("cover unknown routes (404)", async () => {
		const response = await exports.default.fetch(
			"http://example.com/does-not-exist",
		);
		expect(response.status).toBe(404);
		expectGlobalHeaders(response);
	});
});

describe("consent dialog", () => {
	it("renders with strict CSP, linked stylesheet, and no inline script/style", async () => {
		const clientId = await registerClient();
		const url = new URL("http://example.com/authorize");
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", clientId);
		url.searchParams.set(
			"redirect_uri",
			"https://claude.ai/api/mcp/auth_callback",
		);
		url.searchParams.set("state", "teststate");
		url.searchParams.set("code_challenge", "a".repeat(43));
		url.searchParams.set("code_challenge_method", "S256");

		const response = await exports.default.fetch(url.href);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Security-Policy")).toBe(EXPECTED_CSP);
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expectGlobalHeaders(response);

		const html = await response.text();
		expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
		expect(html).not.toContain("<style");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onclick");
		expect(html).not.toContain("unsafe-inline");
	});
});

describe("GET / (landing page)", () => {
	it("explains the service and how to connect", async () => {
		const response = await exports.default.fetch("http://example.com/");
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(
			"text/html; charset=utf-8",
		);
		expectGlobalHeaders(response);
		expect(response.headers.get("Cache-Control")).toBe("no-store");

		const html = await response.text();
		// Connector URL derives from PUBLIC_ORIGIN, not the request host.
		expect(html).toContain(`${env.PUBLIC_ORIGIN}/mcp`);
		expect(html.toLowerCase()).toContain("read-only");
		expect(html).toContain("unofficial");
		expect(html).toContain('href="/privacy"');
		// Starter prompt beats a "now what?" moment (PLAN.md §9.3 as amended).
		expect(html).toContain("How did I sleep last week?");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<style");
	});
});

describe("GET /privacy (privacy policy)", () => {
	it("states what is accessed, what is stored, and how to reach us", async () => {
		const response = await exports.default.fetch("http://example.com/privacy");
		expect(response.status).toBe(200);
		expectGlobalHeaders(response);

		const html = await response.text();
		expect(html.toLowerCase()).toContain("read-only");
		expect(html).toContain("hello@wellspring.fit");
		// The four data categories, named (PLAN.md §10).
		for (const category of ["sleep", "body", "activity", "heart"]) {
			expect(html.toLowerCase()).toContain(category);
		}
		// Tokens-only storage claim.
		expect(html.toLowerCase()).toContain("token");
		expect(html).not.toContain("<script");
	});
});

describe("request body size guard", () => {
	it("rejects oversized non-MCP bodies with 413", async () => {
		const response = await exports.default.fetch(
			"http://example.com/register",
			{
				body: "x".repeat(150_000),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			},
		);
		expect(response.status).toBe(413);
	});
});
