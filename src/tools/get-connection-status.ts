// PLAN.md §6 tool 7 — reports token/auth state without touching health data
// or triggering a refresh. Relocated from index.ts in Phase 3 (one file per
// tool); behavior unchanged.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolResult } from "./shared";

export const name = "get_connection_status";

export const description =
	"Check whether this server can currently reach the user's Withings account. Call this first when any Withings data request fails or before troubleshooting.";

export const inputShape = {};

export async function handle(ctx: ToolContext): Promise<ToolResult> {
	const withingsUserId = ctx.props?.withingsUserId;
	if (!withingsUserId) {
		return statusText(
			`No Withings account is linked to this session. Reconnect the Wellspring connector in Claude's settings to start over.`,
		);
	}
	const stub = ctx.env.USER_TOKENS.get(
		ctx.env.USER_TOKENS.idFromName(withingsUserId),
	);
	const status = await stub.getStatus();
	const reconnectUrl = `${ctx.env.PUBLIC_ORIGIN}/withings/connect`;
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
}

function statusText(text: string): ToolResult {
	return { content: [{ text, type: "text" as const }] };
}

export function register(server: McpServer, ctx: ToolContext): void {
	server.tool(name, description, inputShape, () => handle(ctx));
}
