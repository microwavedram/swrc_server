import log from "npmlog"
import fs from "fs"
import { WebsocketInterface } from "./util/WebsocketInterface"
import { RC } from "./services/RC"
import KeyManager, { APIScope } from "./util/KeyManager"

import config from "../config.toml"
import SQLite from "./sqlite"

export class SWRC {
	sqlite: SQLite

	constructor() {
		const writeStream = fs.createWriteStream("nexus.log")

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

	start() {
		const wsInterface = new WebsocketInterface({
			token: this.sqlite.getHeadToken(),
		})

		wsInterface.addPath("/racecontrol", new RC(this))

		wsInterface.listen(8888)
	}
}

new SWRC().start()
