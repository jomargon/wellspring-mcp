// Shared tool scaffolding (PLAN.md §6/§7): every data tool runs through
// runTool() — token fetch from the per-user DO, error mapping onto the three
// user-visible categories, and allowlist-only logging. Tools stay thin.

import type { ErrorCategory } from "../errors";
import {
	notLinkedMessage,
	reauthMessage,
	rejectedMessage,
	unavailableMessage,
	WithingsApiError,
} from "../errors";
import { addDaysYmd, todayYmd } from "../normalize";
import { postWithings } from "../withings/client";
import { devicesBodySchema } from "../withings/schemas";

export interface ToolContext {
	env: Env;
	props?: { withingsUserId: string };
}

/** Per-agent-instance cache for the resolved user timezone. */
export interface TzCache {
	tz?: string;
}

// Structurally compatible with the MCP SDK's CallToolResult (which carries
// an index signature for protocol extensions).
export interface ToolResult {
	[key: string]: unknown;
	content: { type: "text"; text: string }[];
	isError?: boolean;
}

/** A user-facing failure; `userMessage` is shown verbatim in chat. */
export class ToolError extends Error {
	constructor(
		public category: ErrorCategory,
		public userMessage: string,
	) {
		super(`tool_error:${category}`);
		this.name = "ToolError";
	}
}

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertYmd(value: string, paramName: string): void {
	if (!YMD_PATTERN.test(value)) {
		throw new ToolError(
			"invalid_request",
			`The ${paramName} date "${value}" isn't valid. Use YYYY-MM-DD format, e.g. 2026-07-01.`,
		);
	}
}

/**
 * Resolve start/end dates with zero-argument defaults (PLAN.md §6). The
 * timezone is fetched lazily so explicit-date calls on ymd-param endpoints
 * never need an extra upstream request.
 */
export async function resolveDateRange(
	input: { start_date?: string; end_date?: string },
	defaultDays: number,
	getTimeZone: () => Promise<string>,
): Promise<{ startYmd: string; endYmd: string }> {
	if (input.start_date !== undefined) assertYmd(input.start_date, "start");
	if (input.end_date !== undefined) assertYmd(input.end_date, "end");

	let { start_date: startYmd, end_date: endYmd } = input;
	if (startYmd === undefined || endYmd === undefined) {
		const today = todayYmd(await getTimeZone());
		endYmd ??= today;
		startYmd ??= addDaysYmd(endYmd, -defaultDays);
	}

	if (startYmd > endYmd) {
		throw new ToolError(
			"invalid_request",
			`The start date ${startYmd} is after the end date ${endYmd}. Swap them and try again.`,
		);
	}
	return { startYmd, endYmd };
}

/**
 * The user's IANA timezone, from their first device (the only source a Bearer
 * token can reach — the user-info endpoint is partner-only). Cached on the
 * agent instance; falls back to UTC for device-less accounts, which is
 * harmless since those have no data to misplace.
 */
export async function resolveUserTimezone(
	accessToken: string,
	cache: TzCache,
): Promise<string> {
	if (cache.tz) return cache.tz;
	const body = devicesBodySchema.parse(
		await postWithings("/v2/user", { action: "getdevice" }, { accessToken }),
	);
	cache.tz = body.devices.find((d) => d.timezone)?.timezone ?? "UTC";
	return cache.tz;
}

/**
 * Standard empty-state note (PLAN.md §6: graceful empty states). The optional
 * deviceHint names the device capability this data needs, so Claude can
 * distinguish "no data" from "no capable device" without an extra call; the
 * imported-data clause covers the most common false bug report (Apple Health
 * imports show in the Withings app but never through the API).
 */
export function emptyNote(
	what: string,
	range?: { startYmd: string; endYmd: string },
	deviceHint?: string,
): string {
	const scope = range ? ` between ${range.startYmd} and ${range.endYmd}` : "";
	const hint = deviceHint ? ` Recording ${what} requires ${deviceHint}.` : "";
	return (
		`No ${what} found${scope}.${hint} The device may not have synced yet. ` +
		`Opening the Withings app usually triggers a sync. Call get_devices to ` +
		`check that a suitable device is connected and its battery isn't low. ` +
		`Data imported from other apps (like Apple Health) shows in the ` +
		`Withings app but never through this connection.`
	);
}

/** Note appended when Withings reports more records than one page returned. */
export function moreNote(
	more: number | boolean | undefined,
): string | undefined {
	return more
		? "More records exist in this range. Narrow the date range to see the rest."
		: undefined;
}

/**
 * Run a tool body with token resolution, error mapping, and allowlist
 * logging. `fn` returns the compact JSON payload for Claude.
 */
export async function runTool(
	ctx: ToolContext,
	toolName: string,
	fn: (accessToken: string) => Promise<unknown>,
): Promise<ToolResult> {
	const started = Date.now();
	const withingsUserId = ctx.props?.withingsUserId;

	const finish = async (
		outcome: "ok" | ErrorCategory,
		text: string,
		isError: boolean,
	): Promise<ToolResult> => {
		// Allowlist-only (PLAN.md §7): tool, latency, outcome, hashed user id.
		console.log(
			JSON.stringify({
				event: "tool_call",
				tool: toolName,
				ms: Date.now() - started,
				outcome,
				user: withingsUserId ? await hashUserId(withingsUserId) : "anonymous",
			}),
		);
		return isError
			? { content: [{ type: "text", text }], isError: true }
			: { content: [{ type: "text", text }] };
	};

	if (!withingsUserId) {
		return finish("needs_reauth", notLinkedMessage(), true);
	}

	const reconnectUrl = `${ctx.env.PUBLIC_ORIGIN}/withings/connect`;
	const stub = ctx.env.USER_TOKENS.get(
		ctx.env.USER_TOKENS.idFromName(withingsUserId),
	);
	const token = await stub.getAccessToken();
	if (!token.ok) {
		if (token.error === "needs_reauth") {
			return finish("needs_reauth", reauthMessage(reconnectUrl), true);
		}
		return finish("withings_unavailable", unavailableMessage(), true);
	}

	try {
		const payload = await fn(token.accessToken);
		return finish("ok", JSON.stringify(payload), false);
	} catch (error) {
		if (error instanceof ToolError) {
			return finish(error.category, error.userMessage, true);
		}
		if (error instanceof WithingsApiError && error.kind === "invalid_grant") {
			return finish("needs_reauth", rejectedMessage(), true);
		}
		// Transient upstream failures and unparseable responses both degrade to
		// a plain retry message — never raw errors or stacks (PLAN.md §7).
		return finish("withings_unavailable", unavailableMessage(), true);
	}
}

/**
 * Read a numeric field out of a loose `data` record (sleep/workout payloads).
 * Withings sometimes sends numbers as strings; anything else is absent.
 */
export function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

/** 12-hex-char SHA-256 prefix — the only user identifier that may be logged. */
export async function hashUserId(withingsUserId: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(withingsUserId),
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 12);
}
