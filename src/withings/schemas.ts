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
