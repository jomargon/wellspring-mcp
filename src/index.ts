import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { UserTokensDO } from "./tokens/do";
import { register as registerActivity } from "./tools/get-activity";
import { register as registerBodyMeasurements } from "./tools/get-body-measurements";
import { register as registerConnectionStatus } from "./tools/get-connection-status";
import { register as registerDevices } from "./tools/get-devices";
import { register as registerHeartData } from "./tools/get-heart-data";
import { register as registerSleepSummary } from "./tools/get-sleep-summary";
import { register as registerWorkouts } from "./tools/get-workouts";
import { SERVER_INSTRUCTIONS } from "./tools/instructions";
import type { ToolContext, TzCache } from "./tools/shared";
import { WithingsHandler } from "./withings-handler";

// Context from the auth process, encrypted & stored in the client-facing auth
// token and provided to the McpAgent as this.props. Only the stable Withings
// user id lives here — the rotating tokens stay in UserTokensDO.
type Props = {
	withingsUserId: string;
};

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer(
		{
			name: "Wellspring for Withings",
			version: "0.1.0",
		},
		{ instructions: SERVER_INSTRUCTIONS },
	);

	async init() {
		// Lazy getters so tools always see the current props/env, matching the
		// previous behavior of reading this.props inside each handler.
		const agent = this;
		const ctx: ToolContext = {
			get env() {
				return agent.env;
			},
			get props() {
				return agent.props;
			},
		};
		// Per-agent-instance timezone cache: at most one getdevice lookup per
		// session for the epoch-param endpoints (PLAN.md §6 timezone handling).
		const cache: TzCache = {};

		registerConnectionStatus(this.server, ctx);
		registerDevices(this.server, ctx, cache);
		registerSleepSummary(this.server, ctx, cache);
		registerBodyMeasurements(this.server, ctx, cache);
		registerHeartData(this.server, ctx, cache);
		registerActivity(this.server, ctx, cache);
		registerWorkouts(this.server, ctx, cache);
	}
}

export { UserTokensDO };

// Non-MCP routes (auth pages, OAuth endpoints) never legitimately carry large
// bodies; /mcp payloads are validated by the MCP SDK + zod instead.
const MAX_BODY_BYTES = 100_000;

/**
 * Global response hardening (PLAN.md §7): HSTS, nosniff, and a strict referrer
 * policy on every response — provider-internal routes (/token, /register,
 * /.well-known/*) included — plus a request body size guard.
 */
function withSecurityHeaders(
	handler: ExportedHandler<Env>,
): ExportedHandler<Env> {
	return {
		async fetch(request, env, ctx) {
			const { pathname } = new URL(request.url);
			const contentLength = Number(
				request.headers.get("Content-Length") ?? "0",
			);
			if (!pathname.startsWith("/mcp") && contentLength > MAX_BODY_BYTES) {
				return securedResponse(
					new Response("Request body too large", { status: 413 }),
				);
			}
			if (!handler.fetch) {
				return new Response("Not found", { status: 404 });
			}
			const response = await handler.fetch(
				request as Parameters<NonNullable<ExportedHandler<Env>["fetch"]>>[0],
				env,
				ctx,
			);
			// WebSocket upgrade responses must pass through untouched.
			if (response.webSocket) {
				return response;
			}
			return securedResponse(response);
		},
	};
}

function securedResponse(response: Response): Response {
	const secured = new Response(response.body, response);
	secured.headers.set(
		"Strict-Transport-Security",
		"max-age=31536000; includeSubDomains",
	);
	secured.headers.set("X-Content-Type-Options", "nosniff");
	secured.headers.set("Referrer-Policy", "no-referrer");
	return secured;
}

export default withSecurityHeaders(
	new OAuthProvider({
		allowPlainPKCE: false,
		apiHandler: MyMCP.serve("/mcp"),
		apiRoute: "/mcp",
		authorizeEndpoint: "/authorize",
		clientRegistrationEndpoint: "/register",
		defaultHandler: WithingsHandler as unknown as ExportedHandler,
		tokenEndpoint: "/token",
	}) as unknown as ExportedHandler<Env>,
);
