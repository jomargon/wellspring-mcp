// Priority test 5 (PLAN.md §7): unit normalization, dual-unit output, and
// user-timezone date conversion round-trips. Pure units — no health data.

import { describe, expect, it } from "vitest";
import {
	addDaysYmd,
	decodeMeasureValue,
	epochToLocalTime,
	epochToYmd,
	formatDuration,
	toDualDistance,
	toDualHeight,
	toDualTemperature,
	toDualWeight,
	todayYmd,
	ymdToEpoch,
} from "../src/normalize";

describe("decodeMeasureValue", () => {
	it("decodes value × 10^unit into plain floats", () => {
		expect(decodeMeasureValue(82400, -3)).toBe(82.4);
		expect(decodeMeasureValue(721, -1)).toBe(72.1);
		expect(decodeMeasureValue(180, 0)).toBe(180);
		expect(decodeMeasureValue(5, 3)).toBe(5000);
	});

	it("avoids floating-point artifacts at the encoded precision", () => {
		expect(decodeMeasureValue(823, -1)).toBe(82.3); // not 82.30000000000001
	});
});

describe("toDualWeight", () => {
	it("returns both unit systems", () => {
		expect(toDualWeight(82.4)).toEqual({ kg: 82.4, lb: 181.66 });
		expect(toDualWeight(0)).toEqual({ kg: 0, lb: 0 });
	});
});

describe("dual-unit helpers (Phase 3)", () => {
	it("toDualDistance returns km and mi at 2 decimals", () => {
		expect(toDualDistance(10000)).toEqual({ km: 10, mi: 6.21 });
		expect(toDualDistance(0)).toEqual({ km: 0, mi: 0 });
		expect(toDualDistance(1609.344)).toEqual({ km: 1.61, mi: 1 });
	});

	it("toDualHeight returns cm and feet-inches", () => {
		expect(toDualHeight(1.8)).toEqual({ cm: 180, ft_in: `5'11"` });
		// Rounding up to a full foot must carry (72.008in → 6'0", never 5'12").
		expect(toDualHeight(1.829)).toEqual({ cm: 182.9, ft_in: `6'0"` });
	});

	it("toDualTemperature returns celsius and fahrenheit", () => {
		expect(toDualTemperature(36.6)).toEqual({ c: 36.6, f: 97.9 });
		expect(toDualTemperature(0)).toEqual({ c: 0, f: 32 });
	});
});

describe("formatDuration", () => {
	it("formats seconds as hours and minutes", () => {
		expect(formatDuration(27120)).toBe("7h 32m");
		expect(formatDuration(3600)).toBe("1h 0m");
	});

	it("omits hours below one hour", () => {
		expect(formatDuration(300)).toBe("5m");
		expect(formatDuration(0)).toBe("0m");
	});
});

describe("calendar helpers (Phase 3)", () => {
	it("addDaysYmd does pure calendar math across boundaries", () => {
		expect(addDaysYmd("2026-07-15", 1)).toBe("2026-07-16");
		expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDaysYmd("2026-07-15", -30)).toBe("2026-06-15");
	});

	it("todayYmd returns today in the given timezone", () => {
		const nowSeconds = Math.floor(Date.now() / 1000);
		for (const timeZone of ["UTC", "Asia/Tokyo", "America/New_York"]) {
			expect(todayYmd(timeZone)).toBe(epochToYmd(nowSeconds, timeZone));
		}
	});

	it("epochToLocalTime formats HH:MM in the given timezone", () => {
		const midnightTokyo = ymdToEpoch("2026-07-15", "Asia/Tokyo");
		expect(epochToLocalTime(midnightTokyo, "Asia/Tokyo")).toBe("00:00");
		expect(
			epochToLocalTime(midnightTokyo + 23 * 3600 + 41 * 60, "Asia/Tokyo"),
		).toBe("23:41");
	});
});

describe("user-timezone date conversion", () => {
	it("round-trips YYYY-MM-DD through epoch in a non-UTC timezone", () => {
		for (const timeZone of ["America/New_York", "Asia/Tokyo", "Europe/Paris"]) {
			const epoch = ymdToEpoch("2026-07-15", timeZone);
			expect(epochToYmd(epoch, timeZone)).toBe("2026-07-15");
			// One second before local midnight is still the previous day.
			expect(epochToYmd(epoch - 1, timeZone)).toBe("2026-07-14");
		}
	});

	it("resolves local midnight, not UTC midnight", () => {
		// Tokyo is UTC+9: local midnight is 15:00 UTC the previous day.
		const epoch = ymdToEpoch("2026-07-15", "Asia/Tokyo");
		expect(new Date(epoch * 1000).toISOString()).toBe(
			"2026-07-14T15:00:00.000Z",
		);
	});

	it("handles a DST transition day", () => {
		// US DST spring-forward 2026-03-08 (America/New_York): midnight exists
		// and is UTC-5.
		const epoch = ymdToEpoch("2026-03-08", "America/New_York");
		expect(new Date(epoch * 1000).toISOString()).toBe(
			"2026-03-08T05:00:00.000Z",
		);
		expect(epochToYmd(epoch, "America/New_York")).toBe("2026-03-08");
	});

	it("rejects malformed dates", () => {
		expect(() => ymdToEpoch("07/15/2026", "UTC")).toThrow("Invalid date");
	});
});
