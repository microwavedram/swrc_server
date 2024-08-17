import { Database } from "bun:sqlite"
import crypto from "crypto"
import log from "npmlog"

import config from "../config.toml"
import KeyManager, { APIScope } from "./util/KeyManager"

export interface User {
	id: number
	discord_id: string
}

export interface APIKey {
	key: string
	owner: string
	expiry: number
	scopes: APIScope[]
}

export default class SQLite {
	readonly db: Database

	constructor(source: string) {
		this.db = new Database(source, {
			create: true,
		})
	}

	async setup(): Promise<void> {
		log.info("SQLITE", "Initialising database")

		this.db.exec(
			"CREATE TABLE IF NOT EXISTS api_keys (key STRING PRIMARY KEY, expiry INTEGER, scopes)"
		)

		this.db.exec(
			"CREATE TABLE IF NOT EXISTS meta (key STRING PRIMARY KEY, value STRING)"
		)

		const head_token = await this.createHeadToken()
		log.info("SQLITE", `HEAD-TOKEN: ${head_token}`)

		const apikey = await this.createApiKey([APIScope.PTR])

		log.info("SQLITE", `API-KEY: ${apikey}`)
	}

	async createHeadToken(): Promise<string> {
		const head = crypto.randomBytes(16).toString("hex")

		const query = this.db.prepare(
			`REPLACE INTO meta (key, value) VALUES ("head_token", $head)`
		)

		query.run({
			$head: head,
		})

		return head
	}

	async createApiKey(scopes: APIScope[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const api_key = KeyManager.createKey(scopes)

			const query = this.db.prepare(
				`INSERT INTO api_keys (key, expiry, scopes) VALUES ($key, $expiry, $scopes)`
			)

			try {
				query.run({
					$key: api_key,
					$expiry: Date.now() + 100 * 60 * 60 * 24 * 7,
					$scopes: JSON.stringify(scopes),
				})
			} catch (e) {
				reject(e)
				return
			}

			resolve(api_key)
		})
	}

	getApiKey(key: string): APIKey | null {
		const query = this.db.prepare(`SELECT * FROM api_keys WHERE key = ?`)

		const result = query.get(key) as any | null

		if (result) {
			result.scopes = JSON.parse(result.scopes)
			return result as APIKey
		}

		return null
	}

	getHeadToken(): string {
		const query = this.db.prepare(`SELECT value FROM meta WHERE key = ?`)

		const result = query.get("head_token") as any | null

		if (result.value) {
			return result.value
		}

		log.error("SQLITE", "FAILED TO GET HEAD TOKEN")
		process.exit(0)
	}
}
