// Single home for digest/byte to lowercase-hex encoding, used by token
// hashing, Withings request signatures, and cookie/state hashing. Six copies
// of this loop existed before; any future change (constant-time compare,
// truncation) belongs here alone.

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let hex = "";
	for (const byte of view) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

/** SHA-256 of a UTF-8 string as lowercase hex — the full digest pipeline. */
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return bytesToHex(digest);
}
