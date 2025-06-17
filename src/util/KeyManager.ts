import crypto from "crypto"

function base64Encode(data: any) {
	return Buffer.from(data).toString("base64")
}

export const PROTO = 0

export const enum APIScope {
	RC = "rc",
	WEB = "web",
}

export function scopeDescriptor(scopes: APIScope[]) {
	return base64Encode(scopes.join(":"))
}

export default class KeyManager {
	constructor() {}

	static createKey(scopes: APIScope[]): string {
		const key = crypto.randomBytes(16).toString("base64")

		return base64Encode(
			`${base64Encode(`v${PROTO}`)}.${scopeDescriptor(
				scopes
			)}.${base64Encode(key)}`
		)
	}
}
