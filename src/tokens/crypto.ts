// App-layer encryption for stored Withings tokens (PLAN.md §7 defense-in-depth):
// AES-256-GCM, key from the TOKEN_ENCRYPTION_KEY secret (64 hex chars = 32 bytes),
// fresh random 12-byte IV per encryption. Output format is versioned
// ("v1.<b64 iv>.<b64 ciphertext>") so a future key rotation can migrate records.

const FORMAT_VERSION = "v1";
const IV_BYTES = 12;

export async function importEncryptionKey(hexKey: string): Promise<CryptoKey> {
	const bytes = hexToBytes(hexKey);
	if (bytes.length !== 32) {
		throw new Error(
			"TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)",
		);
	}
	return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}

export async function encryptString(
	key: CryptoKey,
	plaintext: string,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(plaintext),
	);
	return `${FORMAT_VERSION}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptString(
	key: CryptoKey,
	encrypted: string,
): Promise<string> {
	const [version, ivB64, ciphertextB64] = encrypted.split(".");
	if (version !== FORMAT_VERSION || !ivB64 || !ciphertextB64) {
		throw new Error("Unrecognized encrypted token format");
	}
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: base64ToBytes(ivB64) },
		key,
		base64ToBytes(ciphertextB64),
	);
	return new TextDecoder().decode(plaintext);
}

function hexToBytes(hex: string): Uint8Array {
	if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
		throw new Error("Invalid hex string");
	}
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
