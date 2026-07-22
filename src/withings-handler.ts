// Client-facing consent + upstream Withings OAuth (replaces the template's
// GitHub handler). Two flows share the /withings/callback route (the exact
// path registered on the Withings app — Withings exact-matches redirect
// URIs), distinguished by the FlowState stored with the one-time state token:
//   - "mcp-authorize": Claude connecting for the first time (chains the
//     client-facing consent into Withings authorization).
//   - "reauth": the one-click /withings/connect recovery path.

import { env } from "cloudflare:workers";
import type {
	AuthRequest,
	OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { WithingsApiError } from "./errors";
import { buildAuthorizeUrl, exchangeCode } from "./withings/oauth";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

type FlowState =
	| { kind: "mcp-authorize"; oauthReqInfo: AuthRequest; demo?: boolean }
	| { kind: "reauth"; demo?: boolean };

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/authorize", async (c) => {
	let oauthReqInfo: AuthRequest;
	try {
		oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	} catch (_error) {
		return c.text("Invalid request", 400);
	}
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	// `?demo=1` lets a device-less tester (or Withings reviewer) run the whole
	// flow against Withings' demo user.
	const demo = c.req.query("demo") === "1";

	// Check if client is already approved
	if (await isClientApproved(c.req.raw, clientId, env.COOKIE_ENCRYPTION_KEY)) {
		// Skip approval dialog but still create secure state and bind to session
		return startWithingsFlow(c.req.raw, {
			kind: "mcp-authorize",
			oauthReqInfo,
			demo,
		});
	}

	// Generate CSRF protection for the approval form
	const { token: csrfToken, setCookie } = generateCSRFProtection();

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		csrfToken,
		server: {
			description:
				"Unofficial integration for Withings devices. Lets your AI assistant read your Withings sleep, body, activity, and heart data. Read-only — nothing is ever written to your Withings account, and no health data is stored.",
			name: "Wellspring for Withings",
		},
		setCookie,
		state: { oauthReqInfo, demo },
	});
});

app.post("/authorize", async (c) => {
	try {
		// Read form data once
		const formData = await c.req.raw.formData();

		// Validate CSRF token
		validateCSRFToken(formData, c.req.raw);

		// Extract state from form data
		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}

		let state: { oauthReqInfo?: AuthRequest; demo?: boolean };
		try {
			state = JSON.parse(atob(encodedState));
		} catch (_e) {
			return c.text("Invalid state data", 400);
		}

		if (!state.oauthReqInfo?.clientId) {
			return c.text("Invalid request", 400);
		}

		// Add client to approved list
		const approvedClientCookie = await addApprovedClient(
			c.req.raw,
			state.oauthReqInfo.clientId,
			env.COOKIE_ENCRYPTION_KEY,
		);

		return startWithingsFlow(
			c.req.raw,
			{
				kind: "mcp-authorize",
				oauthReqInfo: state.oauthReqInfo,
				demo: state.demo === true,
			},
			[approvedClientCookie],
		);
	} catch (error) {
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		console.error(
			"POST /authorize failed:",
			error instanceof Error ? error.name : "unknown",
		);
		return c.text("Internal server error", 500);
	}
});

/**
 * One-click re-auth (PLAN.md §5): any needs_reauth error links here. Runs the
 * Withings authorize flow and overwrites the user's Durable Object tokens —
 * the DO is keyed by the Withings user id, so no client-facing grant surgery
 * is needed and existing MCP sessions recover on their next tool call.
 */
app.get("/withings/connect", async (c) => {
	const demo = c.req.query("demo") === "1";
	return startWithingsFlow(c.req.raw, { kind: "reauth", demo });
});

/**
 * Withings OAuth callback, shared by both flows.
 *
 * SECURITY: state is validated against both the one-time KV record (proves we
 * created it) and the __Host-CONSENTED_STATE cookie (proves THIS browser
 * consented), preventing injected-state CSRF.
 */
app.get("/withings/callback", async (c) => {
	let flow: FlowState;
	let clearSessionCookie: string;

	try {
		const result = await validateOAuthState<FlowState>(
			c.req.raw,
			c.env.OAUTH_KV,
		);
		flow = result.payload;
		clearSessionCookie = result.clearCookie;
	} catch (error) {
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text("Internal server error", 500);
	}

	const code = c.req.query("code");
	if (!code) {
		return connectionFailedResponse(
			"Withings did not return an authorization code — the connection was cancelled or timed out.",
		);
	}

	// Exchange immediately: Withings authorization codes expire in 30 seconds.
	const redirectUri = new URL("/withings/callback", c.req.url).href;
	let tokens: Awaited<ReturnType<typeof exchangeCode>>;
	try {
		tokens = await exchangeCode(
			{
				clientId: env.WITHINGS_CLIENT_ID,
				clientSecret: env.WITHINGS_CLIENT_SECRET,
			},
			code,
			redirectUri,
		);
	} catch (error) {
		console.error(
			"Withings code exchange failed:",
			error instanceof WithingsApiError ? error.message : "unknown",
		);
		return connectionFailedResponse(
			"We couldn't finish connecting to Withings. Please try again.",
		);
	}

	// Write-before-grant: tokens are durably stored in the user's DO before
	// any client-facing credential is issued.
	const stub = c.env.USER_TOKENS.get(
		c.env.USER_TOKENS.idFromName(tokens.withingsUserId),
	);
	await stub.setTokens({ ...tokens, redirectUri });

	if (flow.kind === "reauth") {
		return htmlResponse(
			reconnectedPageHtml(),
			200,
			clearSessionCookie ? [clearSessionCookie] : [],
		);
	}

	// Return back to the MCP client a new token
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {},
		// This will be available on this.props inside MyMCP. Never put the
		// rotating Withings tokens here — props are frozen at grant time.
		props: { withingsUserId: tokens.withingsUserId },
		request: flow.oauthReqInfo,
		scope: flow.oauthReqInfo.scope,
		userId: tokens.withingsUserId,
	});

	const headers = new Headers({ Location: redirectTo });
	if (clearSessionCookie) {
		headers.set("Set-Cookie", clearSessionCookie);
	}

	return new Response(null, { status: 302, headers });
});

async function startWithingsFlow(
	request: Request,
	flow: FlowState,
	extraCookies: string[] = [],
) {
	const { stateToken } = await createOAuthState<FlowState>(flow, env.OAUTH_KV);
	const { setCookie: sessionBindingCookie } =
		await bindStateToSession(stateToken);

	const headers = new Headers({
		Location: buildAuthorizeUrl({
			clientId: env.WITHINGS_CLIENT_ID,
			redirectUri: new URL("/withings/callback", request.url).href,
			state: stateToken,
			demo: flow.demo,
		}),
	});
	for (const cookie of [...extraCookies, sessionBindingCookie]) {
		headers.append("Set-Cookie", cookie);
	}

	return new Response(null, { headers, status: 302 });
}

function connectionFailedResponse(message: string): Response {
	return htmlResponse(
		simplePageHtml(
			"Connection not completed",
			`${message}`,
			`<a href="/withings/connect">Try connecting again</a>`,
		),
		400,
	);
}

function reconnectedPageHtml(): string {
	return simplePageHtml(
		"Reconnected ✓",
		"Your Withings account is connected again. You can close this tab and go back to Claude — try asking: “How did I sleep last week?”",
	);
}

function simplePageHtml(title: string, message: string, action = ""): string {
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>${title} | Wellspring for Withings</title>
		<style>
			body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; background: #f9fafb; margin: 0; }
			.card { max-width: 480px; margin: 4rem auto; background: #fff; border-radius: 8px; box-shadow: 0 8px 36px 8px rgba(0,0,0,0.1); padding: 2rem; text-align: center; }
			a { color: #0070f3; }
		</style>
	</head>
	<body>
		<div class="card">
			<h1>${title}</h1>
			<p>${message}</p>
			${action ? `<p>${action}</p>` : ""}
		</div>
	</body>
</html>`;
}

function htmlResponse(
	html: string,
	status: number,
	cookies: string[] = [],
): Response {
	const headers = new Headers({
		"Content-Type": "text/html; charset=utf-8",
		// Scripts fully blocked; style-src 'unsafe-inline' only carries the
		// static <style> block. Phase 4 hardening replaces it with a hash.
		"Content-Security-Policy":
			"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
		"X-Frame-Options": "DENY",
	});
	for (const cookie of cookies) {
		headers.append("Set-Cookie", cookie);
	}
	return new Response(html, { status, headers });
}

export { app as WithingsHandler };
