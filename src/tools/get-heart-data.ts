// PLAN.md §6 tool 3: heart readings (ECG results, cuff blood pressure, pulse)
// from /v2/heart action=list. Rows carry no timezone, so timestamps are
// formatted with the user's device timezone. ECG waveform retrieval (action=
// get) is Phase 7.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	addDaysYmd,
	epochToLocalTime,
	epochToYmd,
	ymdToEpoch,
} from "../normalize";
import { postWithings } from "../withings/client";
import { HEART_DEVICE_MODELS } from "../withings/meastypes";
import { heartListBodySchema } from "../withings/schemas";
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

export const name = "get_heart_data";

export const description =
	"Heart readings from Withings ECG-capable devices and blood-pressure cuffs (BPM Core, Move ECG, ScanWatch): heart rate, atrial-fibrillation screening result, and blood pressure per recording. Heart rate synced into the Withings app from other apps (e.g. Apple Health) is not available through the Withings API and will not appear here. Dates are YYYY-MM-DD in the user's timezone; with no arguments it returns the last 30 days. Weigh-in pulse and cuff-only readings also appear in get_body_measurements.";

const AFIB_LABELS: Record<number, string> = {
	0: "negative",
	1: "positive",
	2: "inconclusive",
};

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
		// Epoch-bound endpoint and timezone-less rows: always resolve the tz.
		const tz = await resolveUserTimezone(accessToken, cache);
		const range = await resolveDateRange(input, 30, () => Promise.resolve(tz));

		const body = heartListBodySchema.parse(
			await postWithings(
				"/v2/heart",
				{
					action: "list",
					startdate: String(ymdToEpoch(range.startYmd, tz)),
					enddate: String(ymdToEpoch(addDaysYmd(range.endYmd, 1), tz)),
				},
				{ accessToken },
			),
		);

		const readings = body.series
			.sort((a, b) => a.timestamp - b.timestamp)
			.map((row) => ({
				date: epochToYmd(row.timestamp, tz),
				time: epochToLocalTime(row.timestamp, tz),
				...(row.heart_rate !== undefined && {
					heart_rate_bpm: row.heart_rate,
				}),
				...(row.ecg && {
					afib: AFIB_LABELS[row.ecg.afib] ?? `afib_${row.ecg.afib}`,
				}),
				...(row.bloodpressure && {
					blood_pressure: {
						systolic_mmHg: row.bloodpressure.systole,
						diastolic_mmHg: row.bloodpressure.diastole,
					},
				}),
				...(row.model !== undefined && {
					source: HEART_DEVICE_MODELS[row.model] ?? `model_${row.model}`,
				}),
			}));

		if (readings.length === 0) {
			return {
				readings: [],
				note: emptyNote(
					"heart readings",
					range,
					"a Withings device with heart-rate, ECG, or blood pressure support",
				),
			};
		}
		const note = moreNote(body.more);
		return { readings, ...(note && { note }) };
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
