// Priority test 5 (PLAN.md §7): unit normalization, dual-unit output, and
// user-timezone date conversion round-trips. Pure units — no health data.

import { describe, expect, it } from "vitest";
import {
	decodeMeasureValue,
	epochToYmd,
	toDualWeight,
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
