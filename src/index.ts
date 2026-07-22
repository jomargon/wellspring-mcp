import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { UserTokensDO } from "./tokens/do";
import { WithingsHandler } from "./withings-handler";

// Context from the auth process, encrypted & stored in the client-facing auth
// token and provided to the McpAgent as this.props. Only the stable Withings
// user id lives here — the rotating tokens stay in UserTokensDO.
type Props = {
	withingsUserId: string;
};

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Wellspring for Withings",
		version: "0.1.0",
	});

	async init() {
		// PLAN.md §6 tool 7 — reports token/auth state without touching health
		// data. Pulled into Phase 2 as the end-to-end wiring check; the six
		// data tools follow in Phase 3.
		this.server.tool(
			"get_connection_status",
			"Check whether this server can currently reach the user's Withings account. Call this first when any Withings data request fails or before troubleshooting.",
			{},
			async () => {
				const withingsUserId = this.props?.withingsUserId;
				if (!withingsUserId) {
					return statusText(
						`No Withings account is linked to this session. Reconnect the Wellspring connector in Claude's settings to start over.`,
					);
				}
				const stub = this.env.USER_TOKENS.get(
					this.env.USER_TOKENS.idFromName(withingsUserId),
				);
				const status = await stub.getStatus();
				const reconnectUrl = `${this.env.PUBLIC_ORIGIN}/withings/connect`;
				switch (status) {
					case "ok":
						return statusText("Connected to Withings — everything looks good.");
					case "needs_reauth":
						return statusText(
							`The Withings connection has expired and needs a quick one-click reconnect. Ask the user to open ${reconnectUrl} — it takes about 30 seconds.`,
						);
					case "not_connected":
						return statusText(
							`No Withings account is connected yet. Ask the user to open ${reconnectUrl} to connect one.`,
						);
				}
			},
		);
	}
}

function statusText(text: string) {
	return { content: [{ text, type: "text" as const }] };
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
