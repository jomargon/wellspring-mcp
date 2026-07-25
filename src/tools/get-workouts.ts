// PLAN.md §6 tool 5: workout sessions from /v2/measure action=getworkouts.
// Rows carry their own timezone; categories map to names via the registry.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { epochToLocalTime, formatDuration, toDualDistance } from "../normalize";
import { postWithings } from "../withings/client";
import { workoutCategoryName } from "../withings/meastypes";
import { workoutsBodySchema } from "../withings/schemas";
import {
	asNumber,
	emptyNote,
	moreNote,
	resolveDateRange,
	resolveUserTimezone,
	runTool,
	type ToolContext,
	type ToolResult,
	type TzCache,
} from "./shared";

export const name = "get_workouts";

export const description =
	"Workout sessions with type, start time, duration, calories, distance (km and miles), steps, and heart rate. Dates are YYYY-MM-DD in the user's timezone; with no arguments it returns the last 30 days. Daily activity totals live in get_activity — this tool lists individual sessions.";

const WORKOUT_DATA_FIELDS =
	"calories,steps,distance,elevation,hr_average,hr_min,hr_max,pool_laps,strokes,spo2_average";

export const inputShape = {
	start_date: z
		.string()
		.optional()
		.describe("First day, YYYY-MM-DD (default: 30 days before end_date)"),
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
		const range = await resolveDateRange(input, 30, () =>
			resolveUserTimezone(accessToken, cache),
		);

		const body = workoutsBodySchema.parse(
			await postWithings(
				"/v2/measure",
				{
					action: "getworkouts",
					startdateymd: range.startYmd,
					enddateymd: range.endYmd,
					data_fields: WORKOUT_DATA_FIELDS,
				},
				{ accessToken },
			),
		);

		const workouts = body.series
			.sort((a, b) => a.startdate - b.startdate)
			.map((workout) => {
				const d = workout.data ?? {};
				const calories = asNumber(d.calories);
				const distance = asNumber(d.distance);
				const steps = asNumber(d.steps);
				const hrAvg = asNumber(d.hr_average);
				const poolLaps = asNumber(d.pool_laps);
				const strokes = asNumber(d.strokes);
				return {
					date: workout.date,
					type: workoutCategoryName(workout.category),
					start: epochToLocalTime(workout.startdate, workout.timezone),
					duration: formatDuration(workout.enddate - workout.startdate),
					...(calories !== undefined && {
						calories_kcal: Math.round(calories),
					}),
					...(distance !== undefined && {
						distance: toDualDistance(distance),
					}),
					...(steps !== undefined && { steps }),
					...(hrAvg !== undefined && {
						hr: {
							avg: hrAvg,
							min: asNumber(d.hr_min),
							max: asNumber(d.hr_max),
						},
					}),
					...(poolLaps !== undefined && { pool_laps: poolLaps }),
					...(strokes !== undefined && { strokes }),
				};
			});

		if (workouts.length === 0) {
			return {
				workouts: [],
				note: emptyNote(
					"workouts",
					range,
					"a Withings watch or activity tracker",
				),
			};
		}
		const note = moreNote(body.more);
		return { workouts, ...(note && { note }) };
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
