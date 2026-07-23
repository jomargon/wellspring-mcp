// Shared normalization helpers (PLAN.md §6): Withings' value × 10^unit
// encoding → plain floats, dual-unit output, and user-timezone date handling.
// Tools never inline unit math — it all lives here. Phase 3 extends this file.

const KG_PER_LB = 0.45359237;
const METERS_PER_MILE = 1609.344;
const CM_PER_INCH = 2.54;

/** Decode Withings' `value × 10^unit` fixed-point encoding into a float. */
export function decodeMeasureValue(value: number, unit: number): number {
	// Round to the encoded precision so 82400 × 10^-3 is exactly 82.4.
	const decoded = value * 10 ** unit;
	const decimals = unit < 0 ? -unit : 0;
	return Number(decoded.toFixed(decimals));
}

/** Dual-unit weight so Claude can speak the user's dialect (PLAN.md §6). */
export function toDualWeight(kg: number): { kg: number; lb: number } {
	return {
		kg: Number(kg.toFixed(2)),
		lb: Number((kg / KG_PER_LB).toFixed(2)),
	};
}

/** Dual-unit distance for activity/workout outputs. */
export function toDualDistance(meters: number): { km: number; mi: number } {
	return {
		km: Number((meters / 1000).toFixed(2)),
		mi: Number((meters / METERS_PER_MILE).toFixed(2)),
	};
}

/** Dual-unit height: centimeters plus a feet-inches string like `5'11"`. */
export function toDualHeight(meters: number): { cm: number; ft_in: string } {
	const cm = Number((meters * 100).toFixed(1));
	const totalInches = Math.round((meters * 100) / CM_PER_INCH);
	const feet = Math.floor(totalInches / 12);
	const inches = totalInches % 12;
	return { cm, ft_in: `${feet}'${inches}"` };
}

/** Dual-unit temperature (body temperature meastype). */
export function toDualTemperature(celsius: number): { c: number; f: number } {
	return {
		c: Number(celsius.toFixed(1)),
		f: Number(((celsius * 9) / 5 + 32).toFixed(1)),
	};
}

/** Compact human duration ("7h 32m", "45m") for sleep/workout summaries. */
export function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Today's `YYYY-MM-DD` in the user's timezone — for zero-arg date defaults. */
export function todayYmd(timeZone: string): string {
	return epochToYmd(Math.floor(Date.now() / 1000), timeZone);
}

/** Pure calendar arithmetic on `YYYY-MM-DD` — timezone-independent. */
export function addDaysYmd(ymd: string, days: number): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
	if (!match) {
		throw new Error(`Invalid date: expected YYYY-MM-DD, got "${ymd}"`);
	}
	const [, year, month, day] = match;
	const date = new Date(
		Date.UTC(Number(year), Number(month) - 1, Number(day) + days),
	);
	return date.toISOString().slice(0, 10);
}

/** Format an epoch (seconds) as `HH:MM` wall-clock time in the timezone. */
export function epochToLocalTime(
	epochSeconds: number,
	timeZone: string,
): string {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(new Date(epochSeconds * 1000));
	// en-GB gives "23:41"; midnight can format as "24:00" in some runtimes.
	return parts.replace(/^24:/, "00:");
}

/**
 * Convert an ISO `YYYY-MM-DD` date to the epoch seconds of local midnight in
 * the user's IANA timezone. "Last night's sleep" must resolve against the
 * user's timezone, not UTC (PLAN.md §6).
 */
export function ymdToEpoch(ymd: string, timeZone: string): number {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
	if (!match) {
		throw new Error(`Invalid date: expected YYYY-MM-DD, got "${ymd}"`);
	}
	const [, year, month, day] = match;
	// Start from UTC midnight, then correct by the zone's offset at that
	// moment (a second pass handles DST transitions near midnight).
	let epochMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
	for (let i = 0; i < 2; i++) {
		const offsetMs = epochMs - zonedWallClockAsUtc(epochMs, timeZone);
		epochMs = Date.UTC(Number(year), Number(month) - 1, Number(day)) + offsetMs;
	}
	return Math.floor(epochMs / 1000);
}

/** Format an epoch (seconds) as `YYYY-MM-DD` in the user's IANA timezone. */
export function epochToYmd(epochSeconds: number, timeZone: string): string {
	// en-CA locale formats as YYYY-MM-DD.
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(epochSeconds * 1000));
}

/** The wall-clock time in `timeZone` at `epochMs`, re-read as if it were UTC. */
function zonedWallClockAsUtc(epochMs: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(new Date(epochMs));
	const get = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? 0);
	return Date.UTC(
		get("year"),
		get("month") - 1,
		get("day"),
		get("hour") === 24 ? 0 : get("hour"),
		get("minute"),
		get("second"),
	);
}
