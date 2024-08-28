import crypto from "crypto"

export function getHeadToken() {
	return crypto
		.createHash("sha1")
		.update(new Date().getDate().toString())
		.digest("hex")
}
