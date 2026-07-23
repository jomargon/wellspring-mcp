// PLAN.md §6 tool 6: connected devices + battery — doubles as the connection
// health check and the timezone source for the epoch-param endpoints.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { epochToLocalTime, epochToYmd } from "../normalize";
import { postWithings } from "../withings/client";
import { devicesBodySchema } from "../withings/schemas";
import {
	runTool,
	type ToolContext,
	type ToolResult,
	type TzCache,
} from "./shared";

export const name = "get_devices";

export const description =
	"List the user's connected Withings devices with type, model, battery level, and last-synced time (shown in each device's own timezone). Takes no arguments. Call this when another tool returns no data — an unsynced or low-battery device is the usual cause — or to confirm which devices the account has.";

export const inputShape = {};

export async function handle(
	ctx: ToolContext,
	cache: TzCache,
	_input: Record<string, never>,
): Promise<ToolResult> {
	return runTool(ctx, name, async (accessToken) => {
		const body = devicesBodySchema.parse(
			await postWithings("/v2/user", { action: "getdevice" }, { accessToken }),
		);

		// Free timezone cache fill — saves the epoch-param tools a lookup.
		cache.tz ??= body.devices.find((d) => d.timezone)?.timezone;

		if (body.devices.length === 0) {
			return {
				devices: [],
				note: "No Withings devices are linked to this account. The user needs to set up a device in the Withings app before any data can appear.",
			};
		}

		const devices = body.devices.map((device) => {
			const tz = device.timezone ?? "UTC";
			return {
				...(device.type !== undefined && { type: device.type }),
				...(device.model !== undefined && { model: device.model }),
				...(device.battery !== undefined && { battery: device.battery }),
				...(device.timezone !== undefined && { timezone: device.timezone }),
				...(device.last_session_date != null && {
					last_synced: `${epochToYmd(device.last_session_date, tz)} ${epochToLocalTime(device.last_session_date, tz)}`,
				}),
			};
		});

		const lowBattery = body.devices.filter((d) => d.battery === "low");
		return {
			devices,
			...(lowBattery.length > 0 && {
				note: `The ${lowBattery
					.map((d) => d.model ?? d.type ?? "device")
					.join(
						" and ",
					)} battery is low — a drained battery is a common cause of missing or stale data. Suggest charging or replacing it.`,
			}),
		};
	});
}

export function register(
	server: McpServer,
	ctx: ToolContext,
	cache: TzCache,
): void {
	server.tool(name, description, inputShape, () => handle(ctx, cache, {}));
}
