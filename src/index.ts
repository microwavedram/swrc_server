import log from "npmlog"
import fs from "fs"
import { WebsocketInterface } from "./util/WebsocketInterface"
import { RCEndpoint, RCPacket, type PushTrackPacket } from "./services/RC"

import config from "../config.toml"
import SQLite from "./sqlite"
import { RacerEndpoint, RacerPacket } from "./services/Racer"
import { getHeadToken } from "./util/HeadToken"
import { Race } from "./Race"
import type { AuthWebsocket } from "./util/Websocket"

import express, { type NextFunction } from "express"
import { APIScope } from "./util/KeyManager"

export const MIN_VER = 231

const sleep = async (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms))

export class SWRC {
	sqlite: SQLite

	current_race: Race | null = null
	wsInterface: WebsocketInterface = new WebsocketInterface({})

	express = express()

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

		this.sqlite = new SQLite("db/db.sqlite")

		if (process.argv[2] == "--init") {
			this.sqlite.setup()
		}
	}

	auth(username: string, password: string): boolean {
		log.verbose(username, password)

		if (username != "swrc") return false

		const key_info = this.sqlite.getApiKey(password)

		if (key_info != null) {
			if (key_info.scopes.includes(APIScope.WEB)) {
				return true
			}
		}

		return false
	}

	async start() {
		log.verbose("SWRC", `HEAD-TOKEN: ${getHeadToken(new Date().getDate())}`)

		this.wsInterface.addPath("/racecontrol", new RCEndpoint(this))
		this.wsInterface.addPath("/racer", new RacerEndpoint(this))

		this.wsInterface.listen(config.port)

		this.express.use(express.static("races"))

		this.express.get("/", (request, response) => {
			response.status(2001)
		})

		if (config.express.enabled) {
			this.express.listen(config.express.port, () => {
				log.info("EXPRESS", `Listening on ${config.express.port}`)
			})
		}

		while (true) {
			const update_begin = Date.now()

			if (this.current_race) {
				this.current_race.update()
			}

			await sleep(
				Math.max(0, config.update_speed - Date.now() + update_begin)
			)
		}
	}

	newRace(data: PushTrackPacket) {
		this.current_race = new Race(this, data)

		const racerEndpoint = this.wsInterface.getPath("/racer")

		racerEndpoint?.clients.forEach((client) => {
			racerEndpoint.sendPacket(
				client as AuthWebsocket,
				RacerPacket.NEWRACE,
				data
			)
		})
	}

	endRace() {
		const racerEndpoint = this.wsInterface.getPath("/racer")

		racerEndpoint?.clients.forEach((client) => {
			racerEndpoint.sendPacket(
				client as AuthWebsocket,
				RacerPacket.ENDRACE,
				{}
			)
		})

		this.current_race = null
	}
}

new SWRC().start()
