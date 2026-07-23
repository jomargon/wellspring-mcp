// PLAN.md §6 tool 2: body measurements from /measure action=getmeas. The
// endpoint takes epoch bounds, so date inputs resolve against the user's
// device timezone; values use Withings' value × 10^unit encoding.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	addDaysYmd,
	decodeMeasureValue,
	epochToLocalTime,
	epochToYmd,
	toDualHeight,
	toDualTemperature,
	toDualWeight,
	ymdToEpoch,
} from "../normalize";
import { postWithings } from "../withings/client";
import {
	BODY_COMP_DEFAULTS,
	MEASURE_TYPE_BY_ID,
	MEASURE_TYPE_NAMES,
	MEASURE_TYPES,
	type MeasureTypeName,
} from "../withings/meastypes";
import { measureBodySchema } from "../withings/schemas";
import {
	emptyNote,
	moreNote,
	resolveDateRange,
	resolveUserTimezone,
	runTool,
	type ToolContext,
	ToolError,
	type ToolResult,
	type TzCache,
} from "./shared";

export const name = "get_body_measurements";

export const description = `Body measurements from the user's scale and other devices, one entry per weigh-in. Available types: ${MEASURE_TYPE_NAMES.join(", ")}. Defaults to weight and body composition over the last 30 days when called with no arguments. Dates are YYYY-MM-DD in the user's timezone; weights include both kg and lb. Blood-pressure readings are grouped with their pulse.`;

export const inputShape = {
	types: z
		.array(z.string())
		.optional()
		.describe(
			`Measurement types to fetch (default: weight + body composition). One of: ${MEASURE_TYPE_NAMES.join(", ")}`,
		),
	start_date: z
		.string()
		.optional()
		.describe("First day, YYYY-MM-DD (default: 30 days before end_date)"),
	end_date: z
		.string()
		.optional()
		.describe("Last day, YYYY-MM-DD (default: today)"),
};

type Input = { types?: string[]; start_date?: string; end_date?: string };

function validateTypes(types: string[] | undefined): MeasureTypeName[] {
	if (!types || types.length === 0) return BODY_COMP_DEFAULTS;
	const unknown = types.filter((t) => !(t in MEASURE_TYPES));
	if (unknown.length > 0) {
		throw new ToolError(
			"invalid_request",
			`Unknown measurement type${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Valid types are: ${MEASURE_TYPE_NAMES.join(", ")}.`,
		);
	}
	return types as MeasureTypeName[];
}

/** Render one decoded measure into the row under its friendly key. */
function renderMeasure(
	row: Record<string, unknown>,
	typeName: MeasureTypeName,
	value: number,
): void {
	switch (MEASURE_TYPES[typeName].unit) {
		case "kg":
			row[typeName] = toDualWeight(value);
			break;
		case "height_m":
			row[typeName] = toDualHeight(value);
			break;
		case "celsius":
			row[typeName] = toDualTemperature(value);
			break;
		case "percent":
			row[`${typeName}_pct`] = value;
			break;
		case "mmHg":
		case "bpm":
			// Collected into the blood_pressure group by the caller.
			row[typeName] = value;
			break;
		default:
			row[typeName] = value;
	}
}

export async function handle(
	ctx: ToolContext,
	cache: TzCache,
	input: Input,
): Promise<ToolResult> {
	return runTool(ctx, name, async (accessToken) => {
		const typeNames = validateTypes(input.types);
		// Epoch-bound endpoint: the timezone is always needed for the window.
		const tz = await resolveUserTimezone(accessToken, cache);
		const range = await resolveDateRange(input, 30, () => Promise.resolve(tz));

		const body = measureBodySchema.parse(
			await postWithings(
				"/measure",
				{
					action: "getmeas",
					category: "1",
					meastypes: typeNames.map((t) => MEASURE_TYPES[t].id).join(","),
					startdate: String(ymdToEpoch(range.startYmd, tz)),
					// End day inclusive: bound at midnight of the following day.
					enddate: String(ymdToEpoch(addDaysYmd(range.endYmd, 1), tz)),
				},
				{ accessToken },
			),
		);

		const displayTz = body.timezone ?? tz;
		const measurements = body.measuregrps
			.sort((a, b) => a.date - b.date)
			.map((grp) => {
				const row: Record<string, unknown> = {
					date: epochToYmd(grp.date, displayTz),
					time: epochToLocalTime(grp.date, displayTz),
				};
				for (const measure of grp.measures) {
					const typeName = MEASURE_TYPE_BY_ID.get(measure.type);
					if (!typeName) continue; // unrequested/unknown type — skip
					renderMeasure(
						row,
						typeName,
						decodeMeasureValue(measure.value, measure.unit),
					);
				}
				// Fold BP + pulse into one reading when a cuff measured them.
				if ("systolic_bp" in row || "diastolic_bp" in row) {
					row.blood_pressure = {
						...(row.systolic_bp !== undefined && {
							systolic_mmHg: row.systolic_bp,
						}),
						...(row.diastolic_bp !== undefined && {
							diastolic_mmHg: row.diastolic_bp,
						}),
						...(row.heart_rate !== undefined && {
							heart_rate_bpm: row.heart_rate,
						}),
					};
					delete row.systolic_bp;
					delete row.diastolic_bp;
					delete row.heart_rate;
				} else if (row.heart_rate !== undefined) {
					row.heart_rate_bpm = row.heart_rate;
					delete row.heart_rate;
				}
				return row;
			});

		if (measurements.length === 0) {
			return { measurements: [], note: emptyNote("body measurements", range) };
		}
		const note = moreNote(body.more);
		return { measurements, ...(note && { note }) };
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
