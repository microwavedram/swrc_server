import log from "npmlog"
import fs from "fs"
import { WebsocketInterface } from "./util/WebsocketInterface"
import {
	RCEndpoint,
	RCPacket,
	type PushTrackPacket as RaceDataPacket,
} from "./services/RC"

import config from "../config.toml"
import SQLite from "./sqlite"
import { RacerEndpoint, RacerPacket } from "./services/Racer"
import { getHeadToken } from "./util/HeadToken"
import { Race } from "./Race"
import type { AuthWebsocket } from "./util/Websocket"

const sleep = async (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms))

export class SWRC {
	sqlite: SQLite

	current_race: Race | null = null
	wsInterface: WebsocketInterface = new WebsocketInterface({})

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

	async start() {
		log.verbose("SWRC", `HEAD-TOKEN: ${getHeadToken()}`)

		this.wsInterface.addPath("/racecontrol", new RCEndpoint(this))
		this.wsInterface.addPath("/racer", new RacerEndpoint(this))

		this.wsInterface.listen(8888)

		while (true) {
			const update_begin = Date.now()

			if (this.current_race) {
				this.current_race.update()
			}

			log.verbose(
				"SWRC",
				`Update took ${Date.now() - update_begin}ms ${
					this.current_race
				}`
			)

			await sleep(
				Math.max(0, config.update_speed - Date.now() + update_begin)
			)
		}
	}

	newRace(data: RaceDataPacket) {
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
}

new SWRC().start()
