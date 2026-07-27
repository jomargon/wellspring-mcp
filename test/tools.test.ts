// Phase 3 tool-layer tests (PLAN.md §6). Withings is mocked at the fetch
// boundary; the token DO is seeded with a fresh synthetic record so no refresh
// noise appears. All fixture values are synthetic — no real health data, ever.

import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	notLinkedMessage,
	reauthMessage,
	rejectedMessage,
	unavailableMessage,
} from "../src/errors";
import { addDaysYmd, ymdToEpoch } from "../src/normalize";
import { handle as getActivity } from "../src/tools/get-activity";
import { handle as getBodyMeasurements } from "../src/tools/get-body-measurements";
import { handle as getDevices } from "../src/tools/get-devices";
import { handle as getHeartData } from "../src/tools/get-heart-data";
import { handle as getSleepSummary } from "../src/tools/get-sleep-summary";
import { handle as getWorkouts } from "../src/tools/get-workouts";
import type { ToolContext, TzCache } from "../src/tools/shared";

const TOKYO = "Asia/Tokyo";

type RecordedCall = { url: string; params: URLSearchParams; headers: Headers };

function withingsJson(status: number, body?: unknown): Response {
	return new Response(JSON.stringify({ status, body }), { status: 200 });
}

/** Routes mocked Withings data calls by `action` and records each call. */
function mockWithingsData(
	handlers: Partial<
		Record<
			| "getdevice"
			| "getmeas"
			| "getsummary"
			| "getactivity"
			| "getworkouts"
			| "list",
			(params: URLSearchParams) => Response
		>
	>,
): RecordedCall[] {
	const calls: RecordedCall[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const params = new URLSearchParams(String(init?.body ?? ""));
		calls.push({ url, params, headers: new Headers(init?.headers) });
		const action = params.get("action") as keyof typeof handlers | null;
		const handler = action ? handlers[action] : undefined;
		if (!handler) throw new Error(`Unexpected Withings call: ${action}`);
		return handler(params);
	});
	return calls;
}

function deviceBody(overrides: Record<string, unknown> = {}) {
	return {
		devices: [
			{
				type: "Scale",
				model: "Body+",
				model_id: 5,
				battery: "high",
				deviceid: "synthetic-device-id",
				timezone: "Asia/Tokyo",
				last_session_date: ymdToEpoch("2026-07-21", "Asia/Tokyo") + 22 * 3600,
				...overrides,
			},
		],
	};
}

let userCounter = 0;

/** Seed a fresh token record in a unique DO and return a matching context. */
async function connectedContext(): Promise<{
	ctx: ToolContext;
	cache: TzCache;
}> {
	const withingsUserId = `tool-test-user-${++userCounter}`;
	const stub = env.USER_TOKENS.get(env.USER_TOKENS.idFromName(withingsUserId));
	await stub.setTokens({
		withingsUserId,
		accessToken: "synthetic-access-token",
		refreshToken: "synthetic-refresh-token",
		expiresAt: Date.now() + 60 * 60_000,
		scope: "user.info,user.metrics,user.activity",
		redirectUri: "https://example.com/callback",
	});
	return { ctx: { env, props: { withingsUserId } }, cache: {} };
}

function payloadOf(result: { content: { text: string }[] }) {
	return JSON.parse(result.content[0]?.text ?? "{}");
}

function textOf(result: { content: { text: string }[] }) {
	return result.content[0]?.text ?? "";
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("get_devices", () => {
	it("returns devices with battery and last-synced time in the device timezone", async () => {
		const { ctx, cache } = await connectedContext();
		const calls = mockWithingsData({
			getdevice: () => withingsJson(0, deviceBody()),
		});

		const result = await getDevices(ctx, cache, {});
		const payload = payloadOf(result);

		expect(payload.devices).toEqual([
			{
				type: "Scale",
				model: "Body+",
				battery: "high",
				timezone: "Asia/Tokyo",
				last_synced: "2026-07-21 22:00",
			},
		]);
		expect(calls[0]?.headers.get("authorization")).toBe(
			"Bearer synthetic-access-token",
		);
		expect(calls[0]?.params.get("action")).toBe("getdevice");
	});

	it("adds a note when any battery is low", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({
			getdevice: () => withingsJson(0, deviceBody({ battery: "low" })),
		});
		const payload = payloadOf(await getDevices(ctx, cache, {}));
		expect(payload.note).toMatch(/battery is low/i);
	});

	it("explains the empty state when no devices exist", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({ getdevice: () => withingsJson(0, { devices: [] }) });
		const payload = payloadOf(await getDevices(ctx, cache, {}));
		expect(payload.devices).toEqual([]);
		expect(payload.note).toMatch(/no withings devices/i);
	});
});

describe("get_sleep_summary", () => {
	it("returns compact nightly summaries in the row's own timezone", async () => {
		const { ctx, cache } = await connectedContext();
		const bedtime = ymdToEpoch("2026-07-15", TOKYO) + 23 * 3600 + 41 * 60;
		const wake = ymdToEpoch("2026-07-16", TOKYO) + 7 * 3600 + 12 * 60;
		const calls = mockWithingsData({
			getsummary: () =>
				withingsJson(0, {
					series: [
						{
							timezone: TOKYO,
							startdate: bedtime,
							enddate: wake,
							date: "2026-07-16",
							data: {
								total_sleep_time: 27120,
								deepsleepduration: 5400,
								remsleepduration: 6000,
								lightsleepduration: 15720,
								wakeupduration: 1800,
								wakeupcount: 3,
								sleep_score: 82,
								hr_average: 58,
								hr_min: 50,
								hr_max: 70,
							},
						},
					],
					more: false,
					offset: 0,
				}),
		});

		const result = await getSleepSummary(ctx, cache, {
			start_date: "2026-07-15",
			end_date: "2026-07-16",
		});
		const payload = payloadOf(result);

		expect(payload.nights).toEqual([
			{
				date: "2026-07-16",
				bedtime: "23:41",
				wake: "07:12",
				asleep: "7h 32m",
				deep: "1h 30m",
				rem: "1h 40m",
				light: "4h 22m",
				awake: "30m",
				wakeups: 3,
				sleep_score: 82,
				hr: { avg: 58, min: 50, max: 70 },
			},
		]);
		// Explicit dates on a ymd-param endpoint: no timezone lookup needed.
		expect(calls).toHaveLength(1);
		expect(calls[0]?.params.get("startdateymd")).toBe("2026-07-15");
		expect(calls[0]?.params.get("enddateymd")).toBe("2026-07-16");
		expect(calls[0]?.params.get("data_fields")).toContain("total_sleep_time");
	});

	it("surfaces external-source nights that only carry asleepduration", async () => {
		const { ctx, cache } = await connectedContext();
		const bedtime = ymdToEpoch("2026-07-15", TOKYO) + 23 * 3600;
		const calls = mockWithingsData({
			getsummary: () =>
				withingsJson(0, {
					series: [
						{
							timezone: TOKYO,
							startdate: bedtime,
							enddate: bedtime + 25200,
							date: "2026-07-16",
							// External-source night (spec: light/deep/rem are null,
							// only asleepduration is present).
							data: { asleepduration: 25200 },
						},
					],
					more: false,
					offset: 0,
				}),
		});

		const payload = payloadOf(
			await getSleepSummary(ctx, cache, {
				start_date: "2026-07-15",
				end_date: "2026-07-16",
			}),
		);

		expect(payload.nights[0].asleep).toBe("7h 0m");
		expect(calls[0]?.params.get("data_fields")).toContain("asleepduration");
		expect(calls[0]?.params.get("data_fields")).toContain("total_timeinbed");
	});

	it("explains an empty range instead of returning a bare array", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({
			getsummary: () => withingsJson(0, { series: [], more: false, offset: 0 }),
		});
		const payload = payloadOf(
			await getSleepSummary(ctx, cache, {
				start_date: "2026-07-01",
				end_date: "2026-07-07",
			}),
		);
		expect(payload.nights).toEqual([]);
		expect(payload.note).toMatch(/may not have synced/i);
		// Names the device capability needed and warns about imported data
		// (Phase 4 empty-state pass; PLAN.md §6 "no data" vs "no device").
		expect(payload.note).toMatch(/sleep mat or watch/i);
		expect(payload.note).toMatch(/Apple Health/i);
	});
});

describe("get_body_measurements", () => {
	it("sends epoch bounds at device-timezone midnight and decodes measures", async () => {
		const { ctx, cache } = await connectedContext();
		const grpDate = ymdToEpoch("2026-07-15", TOKYO) + 8 * 3600 + 30 * 60;
		const calls = mockWithingsData({
			getdevice: () => withingsJson(0, deviceBody()),
			getmeas: () =>
				withingsJson(0, {
					timezone: TOKYO,
					measuregrps: [
						{
							grpid: 1,
							date: grpDate,
							category: 1,
							measures: [
								{ value: 82400, type: 1, unit: -3 },
								{ value: 231, type: 6, unit: -1 },
							],
						},
					],
					more: 0,
					offset: 0,
				}),
		});

		const result = await getBodyMeasurements(ctx, cache, {
			start_date: "2026-07-10",
			end_date: "2026-07-16",
		});
		const payload = payloadOf(result);

		expect(payload.measurements).toEqual([
			{
				date: "2026-07-15",
				time: "08:30",
				weight: { kg: 82.4, lb: 181.66 },
				fat_ratio_pct: 23.1,
			},
		]);

		const meas = calls.find((c) => c.params.get("action") === "getmeas");
		expect(meas?.params.get("category")).toBe("1");
		expect(meas?.params.get("meastypes")).toBe("1,6,8,76,77,88");
		expect(meas?.params.get("startdate")).toBe(
			String(ymdToEpoch("2026-07-10", TOKYO)),
		);
		// End day inclusive: bound is midnight of the day after end_date.
		expect(meas?.params.get("enddate")).toBe(
			String(ymdToEpoch(addDaysYmd("2026-07-16", 1), TOKYO)),
		);
	});

	it("groups blood pressure and its pulse into one reading", async () => {
		const { ctx, cache } = await connectedContext();
		const grpDate = ymdToEpoch("2026-07-15", TOKYO) + 7 * 3600;
		mockWithingsData({
			getdevice: () => withingsJson(0, deviceBody()),
			getmeas: () =>
				withingsJson(0, {
					timezone: TOKYO,
					measuregrps: [
						{
							date: grpDate,
							measures: [
								{ value: 82, type: 9, unit: 0 },
								{ value: 128, type: 10, unit: 0 },
								{ value: 61, type: 11, unit: 0 },
							],
						},
					],
				}),
		});

		const payload = payloadOf(
			await getBodyMeasurements(ctx, cache, {
				types: ["diastolic_bp", "systolic_bp", "heart_rate"],
				start_date: "2026-07-15",
				end_date: "2026-07-15",
			}),
		);
		expect(payload.measurements[0].blood_pressure).toEqual({
			systolic_mmHg: 128,
			diastolic_mmHg: 82,
			heart_rate_bpm: 61,
		});
	});

	it("rejects unknown measurement types with the valid vocabulary", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({ getdevice: () => withingsJson(0, deviceBody()) });
		const result = await getBodyMeasurements(ctx, cache, {
			types: ["cholesterol"],
			start_date: "2026-07-01",
			end_date: "2026-07-15",
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("cholesterol");
		expect(textOf(result)).toContain("weight");
	});

	it("resolves the timezone once and caches it for later calls", async () => {
		const { ctx, cache } = await connectedContext();
		const calls = mockWithingsData({
			getdevice: () => withingsJson(0, deviceBody()),
			getmeas: () => withingsJson(0, { timezone: TOKYO, measuregrps: [] }),
		});

		await getBodyMeasurements(ctx, cache, {
			start_date: "2026-07-01",
			end_date: "2026-07-05",
		});
		await getBodyMeasurements(ctx, cache, {
			start_date: "2026-07-06",
			end_date: "2026-07-10",
		});

		expect(
			calls.filter((c) => c.params.get("action") === "getdevice"),
		).toHaveLength(1);
	});
});

describe("get_heart_data", () => {
	it("formats readings with the resolved timezone and decodes afib/model", async () => {
		const { ctx, cache } = await connectedContext();
		const timestamp = ymdToEpoch("2026-07-10", TOKYO) + 9 * 3600 + 5 * 60;
		const calls = mockWithingsData({
			getdevice: () => withingsJson(0, deviceBody()),
			list: () =>
				withingsJson(0, {
					series: [
						{
							deviceid: "synthetic-device-id",
							model: 44,
							ecg: { signalid: 123, afib: 0 },
							bloodpressure: { diastole: 82, systole: 128 },
							heart_rate: 61,
							timestamp,
						},
					],
					more: false,
					offset: 0,
				}),
		});

		const payload = payloadOf(
			await getHeartData(ctx, cache, {
				start_date: "2026-07-01",
				end_date: "2026-07-15",
			}),
		);

		expect(payload.readings).toEqual([
			{
				date: "2026-07-10",
				time: "09:05",
				heart_rate_bpm: 61,
				afib: "negative",
				blood_pressure: { systolic_mmHg: 128, diastolic_mmHg: 82 },
				source: "BPM Core",
			},
		]);

		const list = calls.find((c) => c.params.get("action") === "list");
		expect(list?.params.get("startdate")).toBe(
			String(ymdToEpoch("2026-07-01", TOKYO)),
		);
		expect(list?.params.get("enddate")).toBe(
			String(ymdToEpoch(addDaysYmd("2026-07-15", 1), TOKYO)),
		);
	});
});

describe("get_workouts", () => {
	it("names the workout category and formats start/duration", async () => {
		const { ctx, cache } = await connectedContext();
		const start = ymdToEpoch("2026-07-14", TOKYO) + 18 * 3600 + 2 * 60;
		mockWithingsData({
			getworkouts: () =>
				withingsJson(0, {
					series: [
						{
							id: 9,
							category: 307,
							timezone: TOKYO,
							startdate: start,
							enddate: start + 42 * 60,
							date: "2026-07-14",
							data: {
								calories: 320,
								distance: 5000,
								steps: 6200,
								hr_average: 140,
								hr_min: 90,
								hr_max: 165,
							},
						},
					],
					more: false,
					offset: 0,
				}),
		});

		const payload = payloadOf(
			await getWorkouts(ctx, cache, {
				start_date: "2026-07-10",
				end_date: "2026-07-16",
			}),
		);

		expect(payload.workouts).toEqual([
			{
				date: "2026-07-14",
				type: "Indoor running",
				start: "18:02",
				duration: "42m",
				calories_kcal: 320,
				distance: { km: 5, mi: 3.11 },
				steps: 6200,
				hr: { avg: 140, min: 90, max: 165 },
			},
		]);
	});

	it("falls back to a category_<n> label for unknown categories", async () => {
		const { ctx, cache } = await connectedContext();
		const start = ymdToEpoch("2026-07-14", TOKYO) + 6 * 3600;
		mockWithingsData({
			getworkouts: () =>
				withingsJson(0, {
					series: [
						{
							category: 9999,
							timezone: TOKYO,
							startdate: start,
							enddate: start + 600,
							date: "2026-07-14",
						},
					],
				}),
		});
		const payload = payloadOf(
			await getWorkouts(ctx, cache, {
				start_date: "2026-07-14",
				end_date: "2026-07-14",
			}),
		);
		expect(payload.workouts[0].type).toBe("category_9999");
	});
});

describe("get_activity", () => {
	it("prefers tracker rows when several sources report the same day", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({
			getactivity: () =>
				withingsJson(0, {
					activities: [
						{
							date: "2026-07-14",
							timezone: TOKYO,
							is_tracker: false,
							brand: 18,
							steps: 4000,
						},
						{
							date: "2026-07-14",
							timezone: TOKYO,
							is_tracker: true,
							steps: 8123,
							distance: 6100,
							active: 3900,
							calories: 412.4,
							totalcalories: 2200.6,
						},
					],
					more: false,
					offset: 0,
				}),
		});

		const payload = payloadOf(
			await getActivity(ctx, cache, {
				start_date: "2026-07-14",
				end_date: "2026-07-14",
			}),
		);

		expect(payload.days).toEqual([
			{
				date: "2026-07-14",
				steps: 8123,
				distance: { km: 6.1, mi: 3.79 },
				active: "1h 5m",
				calories_active_kcal: 412,
				calories_total_kcal: 2201,
			},
		]);
	});
});

describe("shared error mapping", () => {
	it("points at /withings/connect when no tokens exist", async () => {
		const withingsUserId = `tool-test-user-${++userCounter}`; // never seeded
		const ctx: ToolContext = { env, props: { withingsUserId } };
		const result = await getDevices(ctx, {}, {});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("/withings/connect");
	});

	it("asks Claude to reconnect when the session has no user id", async () => {
		const result = await getDevices({ env, props: undefined }, {}, {});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/reconnect/i);
	});

	it("maps a transient upstream failure to a plain retry message", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({ getdevice: () => withingsJson(503) });
		const result = await getDevices(ctx, cache, {});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/try again/i);
		expect(textOf(result)).not.toContain("503");
	});

	it("maps a revoked token on a data call to a reconnect message", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({ getdevice: () => withingsJson(401) });
		const result = await getDevices(ctx, cache, {});
		expect(result.isError).toBe(true);
		// One corrective action (CLAUDE.md): the reconnect link. The silent
		// dead-token report to the DO happens alongside.
		expect(textOf(result)).toMatch(/reconnect/i);
		expect(textOf(result)).toMatch(/\/withings\/connect/);
	});

	it("degrades a malformed response body to the retry message without leaking details", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({
			getdevice: () => withingsJson(0, { devices: "not-an-array" }),
		});
		const result = await getDevices(ctx, cache, {});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/try again/i);
		expect(textOf(result)).not.toMatch(/ZodError|not-an-array|stack/i);
	});

	it("rejects malformed dates with a message naming the expected format", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({ getdevice: () => withingsJson(0, deviceBody()) });
		const result = await getActivity(ctx, cache, {
			start_date: "07/15/2026",
			end_date: "2026-07-16",
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("YYYY-MM-DD");
	});

	it("logs only allowlisted fields — never tokens or measurement values", async () => {
		const { ctx, cache } = await connectedContext();
		mockWithingsData({
			getdevice: () => withingsJson(0, deviceBody()),
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await getDevices(ctx, cache, {});

		expect(logSpy).toHaveBeenCalled();
		for (const call of logSpy.mock.calls) {
			const line = String(call[0]);
			const parsed = JSON.parse(line);
			expect(Object.keys(parsed).sort()).toEqual(
				["event", "ms", "outcome", "tool", "user"].sort(),
			);
			expect(parsed.user).not.toContain(ctx.props?.withingsUserId);
			expect(line).not.toContain("synthetic-access-token");
			expect(line).not.toContain("Body+");
		}
	});
});

describe("user-visible error copy", () => {
	it("every category message names a corrective action, no status codes", () => {
		const reconnectUrl = "https://dev.example/withings/connect";
		const messages = [
			notLinkedMessage(),
			reauthMessage(reconnectUrl),
			rejectedMessage(reconnectUrl),
			unavailableMessage(),
		];
		for (const message of messages) {
			// Plain language: an action the user (or Claude) can take…
			expect(message).toMatch(/reconnect|try again|check/i);
			// …and no raw upstream status codes or jargon (PLAN.md §7 taxonomy).
			// The reconnect link itself is allowed — strip URLs before checking.
			const withoutUrls = message.replace(/https?:\/\/\S+/g, "");
			expect(withoutUrls).not.toMatch(/\b\d{3}\b/);
			expect(withoutUrls).not.toMatch(/oauth|http|token/i);
		}
		expect(reauthMessage(reconnectUrl)).toContain(reconnectUrl);
		expect(rejectedMessage(reconnectUrl)).toContain(reconnectUrl);
	});
});
