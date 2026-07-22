// Per-user Withings token store — the load-bearing component (PLAN.md §5).
// One DO per user, addressed by idFromName(withingsUserId). All token refresh
// flows through this single code path: proactive (5-min buffer), coalesced
// (shared in-flight promise), write-before-use, with the three-rung recovery
// ladder. Never add a second writer, cron, or bypass.

import { DurableObject } from "cloudflare:workers";
import type { AuthState, ConnectionStatus, TokenResult } from "../errors";
import { WithingsApiError } from "../errors";
import {
	exchangeCode,
	recoverAuthorizationCode,
	refreshTokens,
	type TokenSet,
} from "../withings/oauth";
import type { WithingsCredentials } from "../withings/signature";
import { decryptString, encryptString, importEncryptionKey } from "./crypto";

const EXPIRY_BUFFER_MS = 5 * 60_000;

// TokenSet plus the redirect URI the tokens were minted with — recovery's
// code exchange (rung 2) needs it, and the DO has no other way to know the
// worker's public origin.
export interface StoredTokenRecord extends TokenSet {
	redirectUri: string;
}

export class UserTokensDO extends DurableObject<Env> {
	#refreshInFlight: Promise<TokenResult> | null = null;
	#keyPromise: Promise<CryptoKey> | null = null;

	/** Overwrite tokens (initial connect and /withings/connect re-auth). */
	async setTokens(record: StoredTokenRecord): Promise<void> {
		await this.#writeTokens(record);
	}

	/** Auth state without touching tokens or Withings. */
	async getStatus(): Promise<ConnectionStatus> {
		const authState = await this.ctx.storage.get<AuthState>("auth_state");
		if (authState === "needs_reauth") return "needs_reauth";
		const encrypted = await this.ctx.storage.get<string>("tokens");
		return encrypted ? "ok" : "not_connected";
	}

	/**
	 * Resolve a usable access token, refreshing if it expires within the
	 * buffer. Concurrent callers share one refresh: the promise cache plus the
	 * DO's single-threaded execution make a double-refresh structurally
	 * impossible.
	 */
	async getAccessToken(): Promise<TokenResult> {
		const authState = await this.ctx.storage.get<AuthState>("auth_state");
		if (authState === "needs_reauth") {
			return { ok: false, error: "needs_reauth" };
		}

		const record = await this.#readTokens();
		if (!record) {
			return { ok: false, error: "needs_reauth" };
		}

		if (record.expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
			return { ok: true, accessToken: record.accessToken };
		}

		this.#refreshInFlight ??= this.#refresh(record).finally(() => {
			this.#refreshInFlight = null;
		});
		return this.#refreshInFlight;
	}

	// --- refresh ladder -----------------------------------------------------

	async #refresh(stored: StoredTokenRecord): Promise<TokenResult> {
		const credentials = this.#credentials();

		// Rung 1: refresh with the stored token; on a transient failure retry
		// once with the same token (it is still valid — Withings keeps the old
		// refresh token alive for 8h after rotation, and nothing rotated here).
		let invalidGrant = false;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const tokens = await refreshTokens(credentials, stored.refreshToken);
				return await this.#commit(tokens, stored.redirectUri);
			} catch (error) {
				if (
					error instanceof WithingsApiError &&
					error.kind === "invalid_grant"
				) {
					invalidGrant = true;
					break;
				}
			}
		}
		if (!invalidGrant) {
			return { ok: false, error: "withings_unavailable" };
		}

		// Rung 2: server-side recovery — Withings issues a fresh authorization
		// code without user involvement. Logged because frequent recovery
		// signals an integration flaw (PLAN.md §5); healthy count stays ~0.
		try {
			const code = await recoverAuthorizationCode(
				credentials,
				stored.withingsUserId,
			);
			const tokens = await exchangeCode(credentials, code, stored.redirectUri);
			const recoveryCount =
				((await this.ctx.storage.get<number>("recovery_count")) ?? 0) + 1;
			await this.ctx.storage.put("recovery_count", recoveryCount);
			console.log(
				JSON.stringify({ event: "withings_token_recovery", recoveryCount }),
			);
			return await this.#commit(tokens, stored.redirectUri);
		} catch (_error) {
			// Rung 3: recovery failed — the only path into needs_reauth.
			await this.ctx.storage.put("auth_state", "needs_reauth");
			return { ok: false, error: "needs_reauth" };
		}
	}

	/**
	 * Write-before-use: the new token chain must be durably stored before the
	 * access token is handed to any caller. If the write fails, the new token
	 * is discarded and the caller retries later with the old refresh token
	 * (still valid within Withings' 8h rotation window).
	 */
	async #commit(tokens: TokenSet, redirectUri: string): Promise<TokenResult> {
		try {
			await this.#writeTokens({ ...tokens, redirectUri });
		} catch (_error) {
			return { ok: false, error: "withings_unavailable" };
		}
		return { ok: true, accessToken: tokens.accessToken };
	}

	// --- storage ------------------------------------------------------------

	async #writeTokens(record: StoredTokenRecord): Promise<void> {
		const encrypted = await encryptString(
			await this.#key(),
			JSON.stringify(record),
		);
		// Single put => atomic: tokens and auth_state can never disagree.
		await this.ctx.storage.put({ tokens: encrypted, auth_state: "ok" });
	}

	async #readTokens(): Promise<StoredTokenRecord | null> {
		const encrypted = await this.ctx.storage.get<string>("tokens");
		if (!encrypted) return null;
		try {
			return JSON.parse(
				await decryptString(await this.#key(), encrypted),
			) as StoredTokenRecord;
		} catch (_error) {
			// Undecryptable record (e.g. rotated encryption key): treat as not
			// connected — the user re-authorizes rather than being stuck.
			return null;
		}
	}

	#key(): Promise<CryptoKey> {
		this.#keyPromise ??= importEncryptionKey(this.env.TOKEN_ENCRYPTION_KEY);
		return this.#keyPromise;
	}

	#credentials(): WithingsCredentials {
		return {
			clientId: this.env.WITHINGS_CLIENT_ID,
			clientSecret: this.env.WITHINGS_CLIENT_SECRET,
		};
	}
}
