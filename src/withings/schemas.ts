import { z } from "zod";

// Withings wraps every response in this envelope: HTTP is always 200, success
// is status === 0, payload nests under `body`. Shapes verified against the
// OpenAPI spec embedded in developer.withings.com's API reference (2026-07).

export const withingsEnvelopeSchema = z.object({
	status: z.number(),
	body: z.unknown().optional(),
	error: z.string().optional(),
});

export type WithingsEnvelope = z.infer<typeof withingsEnvelopeSchema>;

// POST /v2/oauth2 action=requesttoken → body
export const tokenBodySchema = z.object({
	userid: z.union([z.string(), z.number()]).transform(String),
	access_token: z.string().min(1),
	refresh_token: z.string().min(1),
	expires_in: z.number(),
	scope: z.string().optional(),
	token_type: z.string().optional(),
	csrf_token: z.string().optional(),
});

export type TokenBody = z.infer<typeof tokenBodySchema>;

// POST /v2/signature action=getnonce → body
export const nonceBodySchema = z.object({
	nonce: z.string().min(1),
});

// POST /v2/oauth2 action=recoverauthorizationcode → body
export const recoverBodySchema = z.object({
	user: z.object({
		code: z.string().min(1),
	}),
});

// --- Phase 3 data-endpoint bodies ------------------------------------------
// Withings is loose with numerics (ints sometimes arrive as strings), so data
// fields coerce; anything device-dependent is optional. `more` is an int on
// /measure but a boolean on v2 endpoints — shared fragment accepts both.

const moreSchema = z.union([z.number(), z.boolean()]).optional();
const looseNumber = z.coerce.number();

// POST /measure action=getmeas → body
export const measureBodySchema = z.object({
	timezone: z.string().optional(),
	measuregrps: z.array(
		z.object({
			grpid: looseNumber.optional(),
			date: looseNumber,
			category: looseNumber.optional(),
			measures: z.array(
				z.object({
					value: looseNumber,
					type: looseNumber,
					unit: looseNumber,
				}),
			),
		}),
	),
	more: moreSchema,
	offset: looseNumber.optional(),
});

// POST /v2/sleep action=getsummary → body
export const sleepSummaryBodySchema = z.object({
	series: z.array(
		z.object({
			timezone: z.string(),
			startdate: looseNumber,
			enddate: looseNumber,
			date: z.string(),
			data: z.record(z.string(), z.unknown()).optional(),
		}),
	),
	more: moreSchema,
	offset: looseNumber.optional(),
});

// POST /v2/heart action=list → body (rows carry NO timezone)
export const heartListBodySchema = z.object({
	series: z.array(
		z.object({
			deviceid: z.string().nullable().optional(),
			model: looseNumber.optional(),
			ecg: z
				.object({ signalid: looseNumber.optional(), afib: looseNumber })
				.optional(),
			bloodpressure: z
				.object({ diastole: looseNumber, systole: looseNumber })
				.optional(),
			heart_rate: looseNumber.optional(),
			timestamp: looseNumber,
		}),
	),
	more: moreSchema,
	offset: looseNumber.optional(),
});

// POST /v2/measure action=getactivity → body
export const activityBodySchema = z.object({
	activities: z.array(
		z.object({
			date: z.string(),
			timezone: z.string().optional(),
			deviceid: z.string().nullable().optional(),
			brand: looseNumber.optional(),
			is_tracker: z.boolean().optional(),
			steps: looseNumber.optional(),
			distance: looseNumber.optional(),
			elevation: looseNumber.optional(), // floors climbed, not meters
			soft: looseNumber.optional(),
			moderate: looseNumber.optional(),
			intense: looseNumber.optional(),
			active: looseNumber.optional(),
			calories: looseNumber.optional(),
			totalcalories: looseNumber.optional(),
			hr_average: looseNumber.optional(),
			hr_min: looseNumber.optional(),
			hr_max: looseNumber.optional(),
		}),
	),
	more: moreSchema,
	offset: looseNumber.optional(),
});

// POST /v2/measure action=getworkouts → body
export const workoutsBodySchema = z.object({
	series: z.array(
		z.object({
			id: looseNumber.optional(),
			category: looseNumber,
			timezone: z.string(),
			startdate: looseNumber,
			enddate: looseNumber,
			date: z.string(),
			data: z.record(z.string(), z.unknown()).optional(),
		}),
	),
	more: moreSchema,
	offset: looseNumber.optional(),
});

// POST /v2/user action=getdevice → body
export const devicesBodySchema = z.object({
	devices: z.array(
		z.object({
			type: z.string().optional(),
			model: z.string().optional(),
			model_id: looseNumber.optional(),
			battery: z.string().optional(),
			deviceid: z.string().optional(),
			timezone: z.string().optional(),
			last_session_date: looseNumber.nullable().optional(),
		}),
	),
});
