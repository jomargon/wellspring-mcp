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

export default new OAuthProvider({
	allowPlainPKCE: false,
	apiHandler: MyMCP.serve("/mcp"),
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: WithingsHandler as unknown as ExportedHandler,
	tokenEndpoint: "/token",
});
