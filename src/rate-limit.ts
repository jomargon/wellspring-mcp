// Per-IP rate limiting for the auth routes (PLAN.md §7): the OAuth endpoints
// must not be usable for enumeration or abuse. Uses the Workers Rate Limiting
// binding (free plan). Fail-open on limiter errors — this is abuse
// mitigation, not a security boundary, and re-auth availability matters more.

import type { MiddlewareHandler } from "hono";
import { htmlResponse, layout } from "./pages/layout";

export const authRateLimit: MiddlewareHandler<{ Bindings: Env }> = async (
	c,
	next,
) => {
	const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
	let success = true;
	try {
		({ success } = await c.env.AUTH_RATE_LIMIT.limit({ key: ip }));
	} catch (_error) {
		// Fail open — see module comment.
	}
	if (!success) {
		// Allowlist-only log: event name, nothing else (no IPs, no paths tied
		// to identity).
		console.log(JSON.stringify({ event: "rate_limited" }));
		return htmlResponse(tooManyRequestsPage(), 429);
	}
	await next();
};

function tooManyRequestsPage(): string {
	return layout(
		"Slow down a moment",
		`		<div class="card card--message">
			<h1>Slow down a moment</h1>
			<p>Too many attempts from your connection in a short time. Wait a
			minute, then try again.</p>
		</div>`,
	);
}
