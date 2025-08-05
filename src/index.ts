import log from "npmlog"
import fs from "fs"
import { WebsocketInterface } from "./util/WebsocketInterface"
import { RCEndpoint, type PushTrackPacket } from "./services/RC"

import config from "../config.toml"
import SQLite from "./sqlite"
import path from "path"
import { RacerEndpoint } from "./services/Racer"
import { getHeadToken } from "./util/HeadToken"
import { Race } from "./Race"

import express from "express"
import { Key, KeyScope } from "./util/Key"
import { PROTOCOL, Packets } from "./Protocol"
import { SWRCEndpoint } from "./services/SWRC"

const sleep = async (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms))

export class Session {
	private _id

	owning_key: Key

	swrc: SWRC
	race: Race | null = null

	perf: number = 0

	rc_endpoint = new RCEndpoint(this)
	racer_endpoint = new RacerEndpoint(this)

	key: Key | null = null

	constructor(swrc: SWRC, id: string, owning_key: Key) {
		this.swrc = swrc
		this._id = id

		this.owning_key = owning_key

		swrc.wsInterface.addPath("/" + this._id + "/racer", this.racer_endpoint)
		swrc.wsInterface.addPath("/" + this._id + "/rc", this.rc_endpoint)
	}

	update() {
		this.racer_endpoint.sendAllPacket(Packets.HEARTBEAT, {})
		this.rc_endpoint.sendAllPacket(Packets.HEARTBEAT, {})

		if (this.race) {
			const begin = performance.now()
			this.race.update()

			const delta = performance.now() - begin
			this.perf = delta
		} else {
			this.perf = 0
		}
	}

	newRace(data: PushTrackPacket) {
		this.race = new Race(this, data)

		this.racer_endpoint.sendAllPacket(Packets.NEWRACE, data)
	}

	endRace() {
		this.racer_endpoint.sendAllPacket(Packets.ENDRACE, {})

		this.race = null
	}
}

export class SWRC {
	sqlite: SQLite

	wsInterface: WebsocketInterface = new WebsocketInterface({})

	sessions: { [id: string]: Session } = {}

	perf: number = 0

	express = express()

	isRaceIdTaken(id: string) {
		return fs.existsSync(`./races/${id}.race`)
	}

	constructor() {
		const writeStream = fs.createWriteStream("swrc.log")

		if (process.env.NODE_ENV == "dev") log.level = "verbose"

		log.on("log", (log: any) => {
			writeStream.write(
				`[${new Date().toISOString()}] ${
					log.prefix
				} ${log.level.toUpperCase()} ${log.message}` + "\n"
			)
		})

		if (!fs.existsSync("db")) fs.mkdirSync("db")

		const firstRun = !fs.existsSync("db/db.sqlite")

		this.sqlite = new SQLite("db/db.sqlite")

		if (firstRun) {
			log.info("SWRC", "Doing first run initialisation")
			this.sqlite.setup()

			this.sqlite
				.newKey(
					new Set([
						KeyScope.ADMINISTRATOR,
						KeyScope.WEB,
						KeyScope.SESSION,
						KeyScope.RC,
					]),
					"Internal Administrator Key",
					config.default_organisation,
					-1
				)
				.then((key) => {
					log.info("SWRC", "Administrator key: " + key.toKeyString())
				})
		}

		if (!fs.existsSync("./races")) {
			fs.mkdirSync("./races")
		}

		if (process.argv[2] == "--keygen") {
			const label = process.argv[3]
			const org = process.argv[4]

			this.sqlite
				.newKey(new Set([KeyScope.SESSION]), label, org, -1)
				.then((key) => {
					log.info("SWRC", "Generated key: " + key.toKeyString())
				})
		}
	}

	async webAuth(username: string, password: string): Promise<boolean> {
		log.verbose(username, password)

		const key = Key.parseKey(password)

		if (key.isErr()) return false

		const is_key = await this.sqlite.validateKey(key.value)

		if (is_key.isErr() || is_key.value === false) return false

		if (key.value.scopes.has(KeyScope.WEB)) {
			return true
		}

		return false
	}

	async start() {
		const root_endpoint = new SWRCEndpoint(this)

		this.wsInterface.addPath("/", root_endpoint)
		this.wsInterface.listen(config.port)

		log.verbose("SWRC", "HEAD: " + getHeadToken(new Date().getDate()))

		this.express.use("/races", express.static("races"))
		this.express.get("/races/:name", (req, res, next) => {
			const filename = req.params.name + ".race"
			const filepath = path.join("races", filename)

			fs.readFile(filepath, "utf-8", (err, data) => {
				if (err) {
					return next()
				}

				res.send(`
					<!DOCTYPE html>
					<html lang="en">
					<head>
						<meta charset="utf-8" />
						<title>Race File: ${filename}</title>
						<style>
						body { font-family: sans-serif; background: #f9f9f9; padding: 2em; }
						pre { background: #eee; padding: 1em; border-radius: 5px; }
						</style>
					</head>
					<body>
						<h1>${filename}</h1>
						<a href="${encodeURIComponent(filename)}" download>Download Race File</a>
						<pre>${data
							.replace(/&/g, "&amp;")
							.replace(/</g, "&lt;")
							.replace(/>/g, "&gt;")}</pre>
					</body>
					</html>
				`)
			})
		})

		this.express.enable("trust proxy")

		this.express.use("/", express.static("public"))
		this.express.get("/", (request, response) => {
			response.send(`
				<!DOCTYPE html>
				<html lang="en">
				<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>Status Page</title>
				<link rel="stylesheet" href="/style.css" />
				</head>
				<body>
				<div class="container">
					<h1>SWRC v3.0.0</h1>
					<p>Status: <span class="ok">All Systems "Operational"</span></p>
					<p>For future me: If you are reading this, congratulations for beating nginx</p>
					<p>they call me "the nginx beater"</p>
				</div>
				</body>
				</html>
			`)
		})

		if (config.express.enabled) {
			this.express.listen(config.express.port, () => {
				log.info("EXPRESS", `Listening on ${config.express.port}`)
			})
		}

		while (true) {
			const update_begin = performance.now()

			const sessions: { [id: string]: Object } = {}

			for (const [id, session] of Object.entries(this.sessions)) {
				session.update()

				sessions[id] = {
					perf: session.perf,
					state:
						session.race != null
							? `[${session.race.id}] ${session.race.racers.length} players @ ${session.race.track.name}`
							: "Inactive",
				}
			}

			this.perf = performance.now() - update_begin

			root_endpoint.sendAllPacket(Packets.SESSIONS, {
				sessions: sessions,
				perf: this.perf,
			})

			await sleep(
				Math.max(
					0,
					config.update_speed - performance.now() + update_begin
				)
			)
		}
	}
}

new SWRC().start()
