import { Database } from "bun:sqlite"
import crypto from "crypto"
import log, { error } from "npmlog"

import config from "../config.toml"
import { Key, KeyScope } from "./util/Key"
import { Result, ok, err } from "neverthrow"

export interface User {
	id: number
	discord_id: string
}

export enum KeyState {
	VALID,
	EXPIRED,
	MONKEY,
	INVALID,
}

export default class SQLite {
	readonly db: Database

	constructor(source: string) {
		this.db = new Database(source, {
			create: true,
		})
	}

	async setup(): Promise<void> {
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS api_keys (key STRING PRIMARY KEY, comment STRING, org STRING, expiry INTEGER)"
		)

		this.db.exec(
			"CREATE TABLE IF NOT EXISTS meta (key STRING PRIMARY KEY, value STRING)"
		)
	}

	async newKey(
		scopes: Set<KeyScope>,
		comment: string | null = null,
		org: string = "generic",
		expirySecconds: number = 100 * 60 * 60 * 24 * 7
	): Promise<Key> {
		return new Promise((resolve, reject) => {
			const api_key = Key.newKey(scopes)

			const query = this.db.prepare(
				`INSERT INTO api_keys (key, comment, org, expiry) VALUES ($key, $comment, $org, $expiry)`
			)

			try {
				query.run({
					$key: api_key.toKeyString(),
					$comment: comment ?? null,
					$expiry:
						expirySecconds === -1
							? -1
							: Date.now() + expirySecconds,
					$org: org,
				})
			} catch (e) {
				reject(e)
				return
			}

			resolve(api_key)
		})
	}

	async validateKey(
		key: Key
	): Promise<Result<boolean, "FAILED" | "INVALID">> {
		try {
			const query = this.db.prepare(
				`SELECT * FROM api_keys WHERE key = ?`
			)

			const result = query.get(key.toKeyString()) as any | null

			if (!result) {
				return err("INVALID")
			}

			if (result.expiry !== -1 && result.expiry < Date.now()) {
				return ok(false)
			}

			return ok(true)
		} catch (e) {
			console.error("validateKey error:", e)
			return err("FAILED")
		}
	}

	async getKeyComment(key: Key): Promise<Result<string, "FAILED">> {
		return new Promise((resolve) => {
			try {
				const query = this.db.prepare(
					`SELECT comment FROM api_keys WHERE key = ?`
				)
				const result = query.get(key.toKeyString()) as {
					comment: string
				} | null

				if (result && result.comment != null) {
					resolve(ok(result.comment))
				} else {
					resolve(err("FAILED"))
				}
			} catch {
				resolve(err("FAILED"))
			}
		})
	}

	async getKeyOrg(key: Key): Promise<Result<string, "FAILED">> {
		return new Promise((resolve) => {
			try {
				const query = this.db.prepare(
					`SELECT org FROM api_keys WHERE key = ?`
				)
				const result = query.get(key.toKeyString()) as {
					org: string
				} | null

				if (result && result.org != null) {
					resolve(ok(result.org))
				} else {
					resolve(err("FAILED"))
				}
			} catch {
				resolve(err("FAILED"))
			}
		})
	}
}
