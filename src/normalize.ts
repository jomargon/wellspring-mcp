// Shared normalization helpers (PLAN.md §6): Withings' value × 10^unit
// encoding → plain floats, dual-unit output, and user-timezone date handling.
// Tools never inline unit math — it all lives here. Phase 3 extends this file.

const KG_PER_LB = 0.45359237;

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
