import { describe, expect, it } from "vitest";
import {
	decryptString,
	encryptString,
	importEncryptionKey,
} from "../src/tokens/crypto";

const TEST_KEY_HEX = `${"0".repeat(63)}1`; // fixed test-only key, no secret value

describe("token crypto", () => {
	it("round-trips a string", async () => {
		const key = await importEncryptionKey(TEST_KEY_HEX);
		const encrypted = await encryptString(key, "fake-token-material");
		expect(encrypted).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
		expect(await decryptString(key, encrypted)).toBe("fake-token-material");
	});

	it("uses a fresh IV per encryption", async () => {
		const key = await importEncryptionKey(TEST_KEY_HEX);
		const a = await encryptString(key, "same-plaintext");
		const b = await encryptString(key, "same-plaintext");
		expect(a).not.toBe(b);
		expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
	});

	it("rejects tampered ciphertext", async () => {
		const key = await importEncryptionKey(TEST_KEY_HEX);
		const encrypted = await encryptString(key, "payload");
		const [v, iv, ct] = encrypted.split(".");
		const tamperedCt = ct?.startsWith("A")
			? `B${ct.slice(1)}`
			: `A${ct?.slice(1)}`;
		await expect(
			decryptString(key, `${v}.${iv}.${tamperedCt}`),
		).rejects.toThrow();
	});

	it("rejects an unrecognized format version", async () => {
		const key = await importEncryptionKey(TEST_KEY_HEX);
		await expect(decryptString(key, "v9.aaaa.bbbb")).rejects.toThrow(
			"Unrecognized encrypted token format",
		);
	});

	it("rejects keys that are not 32 bytes of hex", async () => {
		await expect(importEncryptionKey("abcd")).rejects.toThrow();
		await expect(importEncryptionKey("z".repeat(64))).rejects.toThrow();
	});
});
