import crypto from "crypto"
import config from "../../config.toml"
import fs from "fs"
import log from "npmlog"
import { Result, err, ok } from "neverthrow"

function base64Encode(data: any): string {
	return Buffer.from(data)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "")
}

function base64Decode(data: string): Buffer {
	let base64 = data
	while (base64.length % 4) {
		base64 += "="
	}

	base64 = base64.replace(/-/g, "+").replace(/_/g, "/")

	return Buffer.from(base64, "base64")
}

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

export function initKeyChain() {
	const keysDir = "./keys"
	const privateKeyPath = `${keysDir}/private.pem`
	const publicKeyPath = `${keysDir}/public.pem`

	if (!fs.existsSync(keysDir)) {
		log.info("KEYCHAIN", "Creating keys directory")
		fs.mkdirSync(keysDir, { recursive: true })
	}

	let publicKey: crypto.KeyObject
	let privateKey: crypto.KeyObject

	if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
		log.info("KEYCHAIN", "Loading existing key pair")

		try {
			const privateKeyPem = fs.readFileSync(privateKeyPath, "utf-8")
			const publicKeyPem = fs.readFileSync(publicKeyPath, "utf-8")

			privateKey = crypto.createPrivateKey(privateKeyPem)
			publicKey = crypto.createPublicKey(publicKeyPem)

			log.verbose("KEYCHAIN", "Key pair loaded successfully")
		} catch (error) {
			log.error(
				"KEYCHAIN",
				"Failed to load existing keys, generating new ones"
			)
			throw error
		}
	} else {
		log.info(
			"KEYCHAIN",
			"Generating new RSA key pair (this may take a moment)"
		)

		const { publicKey: pubKey, privateKey: privKey } =
			crypto.generateKeyPairSync("ec", {
				namedCurve: "prime256v1",
				publicKeyEncoding: {
					type: "spki",
					format: "pem",
				},
				privateKeyEncoding: {
					type: "pkcs8",
					format: "pem",
				},
			})

		fs.writeFileSync(privateKeyPath, privKey, { mode: 0o600 })
		fs.writeFileSync(publicKeyPath, pubKey, { mode: 0o644 })

		log.info("KEYCHAIN", "Key pair generated and saved")

		privateKey = crypto.createPrivateKey(privKey)
		publicKey = crypto.createPublicKey(pubKey)
	}

	return new KeyChain(publicKey, privateKey)
}

export function scopeDescriptor(scopes: KeyScope[]) {
	return base64Encode(scopes.join(":"))
}

export class KeyChain {
	private public_key: crypto.KeyObject
	private private_key: crypto.KeyObject

	constructor(publicKey: crypto.KeyObject, privateKey: crypto.KeyObject) {
		this.public_key = publicKey
		this.private_key = privateKey
	}

	newKey(
		label: string,
		org: string,
		scopes: Set<KeyScope>,
		inc: number = 0
	): Key {
		const salt = crypto.randomBytes(8)

		const unsigned_key = new Key(
			label,
			org,
			scopes,
			salt,
			inc,
			Buffer.from([])
		)
		const keystring = Buffer.from(unsigned_key.toKeyString())

		const signiture = crypto.sign("sha256", keystring, this.private_key)

		return new Key(label, org, scopes, salt, inc, signiture)
	}

	verifyKey(key: Key): boolean {
		if (!(key.scopes.size == 1 && key.scopes.has(KeyScope.RC))) {
			if (!(key.org in config.keychain.org)) {
				log.verbose(
					"KEYCHAIN",
					"Failed to verify key: bad org " + key.org
				)
				return false
			}

			const org_descriptor = (config.keychain.org as any)[key.org]

			if (!(key.label in org_descriptor.keys)) {
				log.verbose(
					"KEYCHAIN",
					"Failed to verify key: bad label " + key.label
				)

				return false
			}

			if (
				org_descriptor.keys[key.label].inc != undefined &&
				key.inc < org_descriptor.keys[key.label].inc
			) {
				log.verbose(
					"KEYCHAIN",
					"Failed to verify key: bad inc " + key.inc
				)
				return false
			}
		}

		try {
			const unsignedKey = new Key(
				key.label,
				key.org,
				key.scopes,
				key.salt,
				key.inc,
				Buffer.from([])
			)

			const keyString = Buffer.from(unsignedKey.toKeyString())

			const isValid = crypto.verify(
				"sha256",
				keyString,
				this.public_key,
				key.signature
			)

			return isValid
		} catch (e) {
			log.verbose("KEYCHAIN", "Failed to verify key: err:" + e)
			return false
		}
	}

	initial_sign_keys() {
		log.info("KEYCHAIN", "Signing all keys")
		for (const [org_id, org] of Object.entries(config.keychain.org)) {
			for (const [label, descriptor] of Object.entries(org.keys)) {
				const scopes = new Set([KeyScope.SESSION])

				let inc = 0

				if ("inc" in descriptor) {
					inc = (descriptor as any).inc
				}

				if (org_id == "INTERNAL") {
					scopes.add(KeyScope.ADMINISTRATOR)
					scopes.add(KeyScope.RC)
					scopes.add(KeyScope.WEB)
				}

				const key = this.newKey(label, org_id, scopes, inc)

				log.verbose(
					"KEYCHAIN",
					` - ${descriptor.contact.padStart(
						20,
						" "
					)} ${key.toKeyString()}`
				)
			}
		}
	}
}

export class Key {
	readonly label: string
	readonly org: string
	readonly scopes: Set<KeyScope>
	readonly salt: Buffer
	readonly inc: number
	readonly signature: Buffer

	constructor(
		label: string,
		org: string,
		scopes: Set<KeyScope>,
		salt: Buffer,
		inc: number,
		signature: Buffer
	) {
		this.label = label
		this.org = org
		this.scopes = scopes
		this.salt = salt
		this.inc = inc
		this.signature = signature
	}

	static parseKey(key: string): Result<Key, string> {
		const segments = key.toString().split(".")

		if (segments.length !== 6) return err("wrong segments")
		if (segments[1] !== "SWRC") return err("wrong [1]")

		const identity = segments[0]
		const identity_segments = identity.split("@")
		if (identity_segments.length !== 2) return err("wrong identity")
		const [label, org] = identity_segments

		const scopes = new Set(
			base64Decode(segments[2]).toString().split(":")
		) as Set<KeyScope>

		const salt = base64Decode(segments[3])
		const inc = parseInt(base64Decode(segments[4]).toString())
		const signature = base64Decode(segments[5])

		return ok(new Key(label, org, scopes, salt, inc, signature))
	}

	toKeyString() {
		return `${this.label}@${this.org}.SWRC.${scopeDescriptor(
			Array.from(this.scopes)
		)}.${base64Encode(this.salt)}.${base64Encode(
			this.inc.toString()
		)}.${base64Encode(this.signature)}`
	}

	equals(other: Key) {
		return other instanceof Key && other.toKeyString() == this.toKeyString()
	}
}
