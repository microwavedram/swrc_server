import crypto from "crypto"
import { Result, err, ok } from "neverthrow"

function base64Encode(data: any): string {
	return Buffer.from(data).toString("base64")
}

function base64Decode(data: string): string {
	return Buffer.from(data, "base64").toString()
}

export const PROTO = 1

export const enum KeyScope {
	// Race control token, generated for individual races
	RC = "rc",

	// Access the swrc endpoint, create a session and generate the token
	SESSION = "session",

	// Access the express endpoint
	WEB = "web",

	// no session limit, can delete any session
	// can race control for any race
	ADMINISTRATOR = "administrator",
}

export function scopeDescriptor(scopes: KeyScope[]) {
	return base64Encode(scopes.join(":"))
}

export class Key {
	readonly version: number
	readonly scopes: Set<KeyScope>
	readonly secret: Buffer

	constructor(scopes: Set<KeyScope>, secret: Buffer) {
		this.version = PROTO
		this.scopes = scopes
		this.secret = secret
	}

	static parseKey(
		key: string
	): Result<
		Key,
		"EMPTY" | "WRONG_SEGMENTS" | "WRONG_SEGMENTS" | "VERSION_MISMATCH"
	> {
		const buffer = Buffer.from(key, "base64")

		const segments = buffer.toString().split(".")

		if (segments.length == 0) return err("EMPTY")

		if (base64Decode(segments[0]) !== `v${PROTO}`)
			return err("VERSION_MISMATCH")

		if (segments.length != 3) return err("WRONG_SEGMENTS")

		const scopes = new Set(
			base64Decode(segments[1]).split(":")
		) as Set<KeyScope>
		const secret = Buffer.from(segments[2], "base64")

		return ok(new Key(scopes, secret))
	}

	static newKey(scopes: Set<KeyScope>): Key {
		const secret = crypto.randomBytes(64)

		return new Key(scopes, secret)
	}

	toKeyString() {
		const version = base64Encode(`v${this.version}`)
		const scope_descriptor = scopeDescriptor(Array.from(this.scopes))
		const secret = base64Encode(this.secret)

		return base64Encode(version + "." + scope_descriptor + "." + secret)
	}

	equals(other: Key) {
		return other instanceof Key && other.toKeyString() == this.toKeyString()
	}
}
