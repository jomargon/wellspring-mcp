// PLAN.md §6 tool 1: nightly sleep summaries from /v2/sleep action=getsummary.
// Rows carry their own timezone; bed/wake times are formatted with it so
// "last night" is always the user's night, never UTC's.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { epochToLocalTime, formatDuration } from "../normalize";
import { postWithings } from "../withings/client";
import { sleepSummaryBodySchema } from "../withings/schemas";
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

export const name = "get_sleep_summary";

export const description =
	"Nightly sleep summaries: bed and wake times, time asleep, deep/REM/light/awake breakdown, wakeups, sleep score, heart and breathing rates. Dates are YYYY-MM-DD in the user's timezone; a night is filed under its wake-up date. With no arguments it returns the last 7 nights. Only sleep recorded by Withings devices is available — sleep synced into the Withings app from other apps (e.g. Apple Health) does not come through the Withings API. If empty, check get_devices: no sleep-capable device means the app's sleep data is imported and unreachable here.";

const SLEEP_DATA_FIELDS =
	"total_sleep_time,total_timeinbed,asleepduration,lightsleepduration,remsleepduration,deepsleepduration,wakeupduration,wakeupcount,sleep_latency,wakeup_latency,sleep_efficiency,sleep_score,hr_average,hr_min,hr_max,rr_average,snoring,snoringepisodecount,breathing_disturbances_intensity,apnea_hypopnea_index";

export const inputShape = {
	start_date: z
		.string()
		.optional()
		.describe("First night, YYYY-MM-DD (default: 7 days before end_date)"),
	end_date: z
		.string()
		.optional()
		.describe("Last night, YYYY-MM-DD (default: today)"),
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

		const body = sleepSummaryBodySchema.parse(
			await postWithings(
				"/v2/sleep",
				{
					action: "getsummary",
					startdateymd: range.startYmd,
					enddateymd: range.endYmd,
					data_fields: SLEEP_DATA_FIELDS,
				},
				{ accessToken },
			),
		);

		const nights = body.series
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((night) => {
				const d = night.data ?? {};
				const duration = (key: string) => {
					const seconds = asNumber(d[key]);
					return seconds === undefined ? undefined : formatDuration(seconds);
				};
				const hrAvg = asNumber(d.hr_average);
				// External-source nights carry asleepduration instead of
				// total_sleep_time (and no stage breakdown).
				const asleep =
					duration("total_sleep_time") ?? duration("asleepduration");
				return {
					date: night.date,
					bedtime: epochToLocalTime(night.startdate, night.timezone),
					wake: epochToLocalTime(night.enddate, night.timezone),
					...(asleep && { asleep }),
					...(duration("total_timeinbed") && {
						in_bed: duration("total_timeinbed"),
					}),
					...(duration("deepsleepduration") && {
						deep: duration("deepsleepduration"),
					}),
					...(duration("remsleepduration") && {
						rem: duration("remsleepduration"),
					}),
					...(duration("lightsleepduration") && {
						light: duration("lightsleepduration"),
					}),
					...(duration("wakeupduration") && {
						awake: duration("wakeupduration"),
					}),
					...(asNumber(d.wakeupcount) !== undefined && {
						wakeups: asNumber(d.wakeupcount),
					}),
					...(asNumber(d.sleep_efficiency) !== undefined && {
						sleep_efficiency: asNumber(d.sleep_efficiency),
					}),
					...(asNumber(d.sleep_score) !== undefined && {
						sleep_score: asNumber(d.sleep_score),
					}),
					...(hrAvg !== undefined && {
						hr: {
							avg: hrAvg,
							min: asNumber(d.hr_min),
							max: asNumber(d.hr_max),
						},
					}),
					...(asNumber(d.rr_average) !== undefined && {
						rr_avg: asNumber(d.rr_average),
					}),
					...(duration("snoring") && { snoring: duration("snoring") }),
					...(asNumber(d.snoringepisodecount) !== undefined && {
						snoring_episodes: asNumber(d.snoringepisodecount),
					}),
					...(asNumber(d.breathing_disturbances_intensity) !== undefined && {
						breathing_disturbances: asNumber(
							d.breathing_disturbances_intensity,
						),
					}),
					...(asNumber(d.apnea_hypopnea_index) !== undefined && {
						apnea_hypopnea_index: asNumber(d.apnea_hypopnea_index),
					}),
				};
			});

		if (nights.length === 0) {
			return { nights: [], note: emptyNote("sleep data", range) };
		}
		const note = moreNote(body.more);
		return { nights, ...(note && { note }) };
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
