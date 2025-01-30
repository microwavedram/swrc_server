import crypto from "crypto"

export function getHeadToken(date: number) {
	return crypto.createHash("sha1").update(date.toString()).digest("hex")
}
