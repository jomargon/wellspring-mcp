// PLAN.md §6 tool 4: daily activity summaries (steps, distance, calories,
// active time, heart rate) from /v2/measure action=getactivity.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatDuration, toDualDistance } from "../normalize";
import { postWithings } from "../withings/client";
import { activityBodySchema } from "../withings/schemas";
import {
	emptyNote,
	moreNote,
	resolveDateRange,
	resolveUserTimezone,
	runTool,
	type ToolContext,
	type ToolResult,
	type TzCache,
} from "./shared";

export const name = "get_activity";

export const description =
	"Daily activity summaries: steps, distance (km and miles), floors climbed, active time, calories, and heart rate for each day. Dates are YYYY-MM-DD in the user's timezone; with no arguments it returns the last 7 days. If a day looks missing, the tracker may not have synced — check get_devices.";

const ACTIVITY_DATA_FIELDS =
	"steps,distance,elevation,soft,moderate,intense,active,calories,totalcalories,hr_average,hr_min,hr_max";

export const inputShape = {
	start_date: z
		.string()
		.optional()
		.describe("First day, YYYY-MM-DD (default: 7 days before end_date)"),
	end_date: z
		.string()
		.optional()
		.describe("Last day, YYYY-MM-DD (default: today)"),
};

type Input = { start_date?: string; end_date?: string };

export async function handle(
	ctx: ToolContext,
	cache: TzCache,
	input: Input,
): Promise<ToolResult> {
	return runTool(ctx, name, async (accessToken) => {
		const range = await resolveDateRange(input, 7, () =>
			resolveUserTimezone(accessToken, cache),
		);

		const body = activityBodySchema.parse(
			await postWithings(
				"/v2/measure",
				{
					action: "getactivity",
					startdateymd: range.startYmd,
					enddateymd: range.endYmd,
					data_fields: ACTIVITY_DATA_FIELDS,
				},
				{ accessToken },
			),
		);

		// Multiple sources can report the same day (phone apps, trackers);
		// prefer the row from an actual tracker device.
		const byDate = new Map<string, (typeof body.activities)[number]>();
		for (const row of body.activities) {
			const existing = byDate.get(row.date);
			if (!existing || (row.is_tracker && !existing.is_tracker)) {
				byDate.set(row.date, row);
			}
		}

		const days = [...byDate.values()]
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((row) => ({
				date: row.date,
				...(row.steps !== undefined && { steps: row.steps }),
				...(row.distance !== undefined && {
					distance: toDualDistance(row.distance),
				}),
				...(row.elevation !== undefined && { floors_climbed: row.elevation }),
				...(row.active !== undefined && {
					active: formatDuration(row.active),
				}),
				...(row.calories !== undefined && {
					calories_active_kcal: Math.round(row.calories),
				}),
				...(row.totalcalories !== undefined && {
					calories_total_kcal: Math.round(row.totalcalories),
				}),
				...(row.hr_average !== undefined && {
					hr: { avg: row.hr_average, min: row.hr_min, max: row.hr_max },
				}),
			}));

		if (days.length === 0) {
			return {
				days: [],
				note: emptyNote(
					"activity data",
					range,
					"a Withings watch or activity tracker",
				),
			};
		}
		const note = moreNote(body.more);
		return { days, ...(note && { note }) };
	});
}

export function register(
	server: McpServer,
	ctx: ToolContext,
	cache: TzCache,
): void {
	server.tool(name, description, inputShape, (input: Input) =>
		handle(ctx, cache, input),
	);
}
