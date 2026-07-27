// Per-user Withings token store — the load-bearing component (PLAN.md §5).
// One DO per user, addressed by idFromName(withingsUserId). All token refresh
// flows through this single code path: proactive (5-min buffer), coalesced
// (shared in-flight promise), write-before-use, with the three-rung recovery
// ladder. Never add a second writer, cron, or bypass.

import { DurableObject } from "cloudflare:workers";
import type { AuthState, ConnectionStatus, TokenResult } from "../errors";
import { WithingsApiError } from "../errors";
import { sha256Hex } from "../hex";
import {
	exchangeCode,
	recoverAuthorizationCode,
	refreshTokens,
	type TokenSet,
} from "../withings/oauth";
import type { WithingsCredentials } from "../withings/signature";
import { decryptString, encryptString, importEncryptionKey } from "./crypto";

const EXPIRY_BUFFER_MS = 5 * 60_000;

// Storage key for the SHA-256 hex of an access token reported dead by a data
// call (see reportInvalidToken). Compared at read time in getAccessToken.
const DEAD_TOKEN_KEY = "dead_token_hash";

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

	/**
	 * Erase everything for this user (disconnect flow). After this the DO
	 * reports not_connected — indistinguishable from a never-connected user.
	 */
	async clearTokens(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}

	/** Auth state without touching tokens or Withings. */
	async getStatus(): Promise<ConnectionStatus> {
		const authState = await this.ctx.storage.get<AuthState>("auth_state");
		if (authState === "needs_reauth") return "needs_reauth";
		const encrypted = await this.ctx.storage.get<string>("tokens");
		return encrypted ? "ok" : "not_connected";
	}

	/**
	 * A data call failed invalid_grant with a token this DO handed out —
	 * Withings invalidated it mid-lifetime (password change, revoke+regrant).
	 * Records a dead-token marker so the next getAccessToken() flows through
	 * the normal refresh ladder instead of serving the dead token for up to 3h.
	 *
	 * Not a second token writer: it never touches the tokens key, and
	 * consumers compare the marker against whatever record is current, so a
	 * stale report is inert. Only a hash is stored, and only while tokens
	 * exist — nothing outlives clearTokens' deleteAll.
	 */
	async reportInvalidToken(usedAccessToken: string): Promise<void> {
		// Hash before any storage access; the get+put below touch only
		// storage, and consecutive storage operations keep the DO input gate
		// closed, so the existence check cannot interleave with clearTokens'
		// deleteAll or a setTokens write. A disconnected (empty) DO therefore
		// stays empty — nothing outlives clearTokens.
		const deadHash = await sha256Hex(usedAccessToken);
		const hasTokens = await this.ctx.storage.get<string>("tokens");
		if (!hasTokens) return;
		await this.ctx.storage.put(DEAD_TOKEN_KEY, deadHash);
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

		// The raw ciphertext doubles as a change detector for the rung-3 guard
		// in #refresh: every #writeTokens encrypts with a fresh random IV, so
		// any concurrent write produces a different blob.
		const encrypted = await this.ctx.storage.get<string>("tokens");
		if (!encrypted) {
			return { ok: false, error: "needs_reauth" };
		}
		const record = await this.#decryptRecord(encrypted);
		if (!record) {
			return { ok: false, error: "needs_reauth" };
		}

		if (record.expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
			const deadHash = await this.ctx.storage.get<string>(DEAD_TOKEN_KEY);
			if (!deadHash) {
				return { ok: true, accessToken: record.accessToken };
			}
			if ((await sha256Hex(record.accessToken)) !== deadHash) {
				// Marker from a superseded chain: retire it so later calls
				// skip the extra hash. Only the marker key is touched.
				await this.ctx.storage.delete(DEAD_TOKEN_KEY);
				return { ok: true, accessToken: record.accessToken };
			}
			// Reported dead mid-lifetime: fall through to the refresh ladder.
		}

		this.#refreshInFlight ??= this.#refresh(record, encrypted).finally(() => {
			this.#refreshInFlight = null;
		});
		return this.#refreshInFlight;
	}

	// --- refresh ladder -----------------------------------------------------

	async #refresh(
		stored: StoredTokenRecord,
		storedBlob: string,
	): Promise<TokenResult> {
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
			// Rung 3: recovery failed — the only path into needs_reauth. Guard:
			// flip state only if the chain this refresh failed on is still the
			// current one. The get+put are consecutive storage ops (input gate
			// stays closed between them), and any concurrent setTokens or
			// clearTokens changed or removed the blob, so a stale failure backs
			// off quietly instead of clobbering a fresh reconnect or a wiped DO.
			const current = await this.ctx.storage.get<string>("tokens");
			if (current !== storedBlob) {
				return { ok: false, error: "withings_unavailable" };
			}
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
		// A new chain retires any dead-token marker. Ordering is safe: a crash
		// in between leaves a marker that no longer matches the new access
		// token, which reads as "no marker".
		await this.ctx.storage.delete(DEAD_TOKEN_KEY);
	}

	async #decryptRecord(encrypted: string): Promise<StoredTokenRecord | null> {
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
