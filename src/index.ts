import log from "npmlog"
import fs from "fs"
import { WebsocketInterface } from "./util/WebsocketInterface"
import { RCEndpoint, type PushTrackPacket } from "./services/RC"

import config from "../config.toml"
import path from "path"
import { RacerEndpoint } from "./services/Racer"
import { getHeadToken } from "./util/HeadToken"
import { Race } from "./Race"

import express from "express"
import { Key, KeyChain, KeyScope, initKeyChain } from "./util/KeyChain"
import { Packets } from "./Protocol"
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

	status: string = "Probably racing"

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
	wsInterface: WebsocketInterface = new WebsocketInterface({})

	sessions: { [id: string]: Session } = {}

	keychain: KeyChain = initKeyChain()

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

		if (!fs.existsSync("./races")) {
			fs.mkdirSync("./races")
		}

		if (process.argv[2] == "--init") {
			this.keychain.initial_sign_keys()
		}
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
							body {
								background: #0a0a0a;
								font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
								color: #e0e0e0;
								margin: 0;
								padding: 40px;
								min-height: 100vh;
							}
							.container {
								max-width: 1200px;
								margin: 0 auto;
								background: #000000;
								border: 1px solid #ffffff;
							}
							h1 {
								font-size: 1.5em;
								margin: 0;
								padding: 20px;
								color: #ffffff;
								background: #000000;
								border-bottom: 1px solid #ffffff;
								text-transform: uppercase;
								letter-spacing: 2px;
								font-weight: 500;
							}
							.actions {
								padding: 15px 20px;
								border-bottom: 1px solid #333333;
								background: #000000;
							}
							.download-button {
								display: inline-block;
								padding: 7px 16px;
								background: #000000;
								color: #4a9eff;
								text-decoration: none;
								border: 1px solid #4a9eff;
								font-weight: 500;
								font-family: 'Consolas', monospace;
								text-transform: uppercase;
								transition: all 0.15s;
								letter-spacing: 1px;
								font-size: 0.85em;
							}
							.download-button:hover {
								background: #4a9eff;
								color: #000000;
							}
							pre {
								background: #0a0a0a;
								padding: 20px;
								margin: 0;
								color: #e0e0e0;
								font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
								font-size: 0.9em;
								line-height: 1.6;
								overflow-x: auto;
								border: none;
							}
						</style>
					</head>
					<body>
						<div class="container">
							<h1>${filename}</h1>
							<div class="actions">
								<a href="${encodeURIComponent(
									filename
								)}" download class="download-button">Download Race File</a>
							</div>
							<pre>${data
								.replace(/&/g, "&amp;")
								.replace(/</g, "&lt;")
								.replace(/>/g, "&gt;")}</pre>
						</div>
					</body>
					</html>
				`)
			})
		})

		this.express.enable("trust proxy")

		// API endpoint for sessions data
		this.express.get("/api/sessions", (req, res) => {
			const sessionsData: { [id: string]: any } = {}

			for (const [id, session] of Object.entries(this.sessions)) {
				sessionsData[id] = {
					id: id,
					perf: session.perf,
					status: session.status,
					raceId: session.race?.id ?? null,
					trackName: session.race?.track?.name ?? null,
					hasRace: session.race !== null,
					organization:
						(config.keychain.org as any)[session.owning_key.org]
							.name ?? "Unknown",
				}
			}

			res.json({
				sessions: sessionsData,
				perf: this.perf,
				timestamp: new Date().toISOString(),
			})
		})

		this.express.use("/", express.static("public"))
		this.express.get("/", (request, response) => {
			response.send(`
				<!DOCTYPE html>
				<html lang="en">
				<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>SWRC Status</title>
				<link rel="stylesheet" href="/style.css" />
				</head>
				<body>
				<div class="container">
					<h1>SWRC v4.0.0</h1>
					<p>Status: <span class="ok">All Systems Operational</span></p>
					<p>Browser leaderboards coming soon!</p>
					
					<div id="sessions-container">
						<h2>Active Sessions</h2>
						<div id="sessions-list">
							<p class="loading">Loading sessions...</p>
						</div>
					</div>
				</div>
				
				<script>
					async function loadSessions() {
						try {
							const response = await fetch("/api/sessions");
							const data = await response.json();
							
							const sessionsList = document.getElementById("sessions-list");
							const sessions = data.sessions;
							const sessionIds = Object.keys(sessions);
							
							if (sessionIds.length === 0) {
								sessionsList.innerHTML = "<p class=\\"no-sessions\\">No active sessions</p>";
								return;
							}
							
							sessionsList.innerHTML = sessionIds.map(id => {
								const session = sessions[id];
								const perfMs = session.perf.toFixed(2);
								
								let raceInfo = "";
								if (session.hasRace && session.raceId) {
									raceInfo = \`
										<div class="race-info">
											<strong>Race:</strong> \${session.raceId}<br>
											<strong>Track:</strong> \${session.trackName || "Unknown"}<br>
											<a href="/races/\${session.raceId}" class="race-button" target="_blank">View Race</a>
										</div>
									\`;
								} else {
									raceInfo = "<p class=\\"no-race\\">No active race</p>";
								}
								
								return \`
									<div class=\\"session-card\\">
										<div class=\\"session-header\\">
											<span class=\\"session-id\\">\${session.organization} - \${id.split("_")[1] || "Unknown"}</span>
											<span class=\\"session-perf\\">\${perfMs}ms</span>
										</div>
										<div class=\\"session-status\\">\${session.status}</div>
										\${raceInfo}
									</div>
								\`;
							}).join("");
							
						} catch (error) {
							console.error("Failed to load sessions:", error);
							document.getElementById("sessions-list").innerHTML = 
								"<p class=\\"error\\">Failed to load sessions</p>";
						}
					}
					
					// Load sessions immediately
					loadSessions();
					
					// Refresh every 2 seconds
					setInterval(loadSessions, 2000);
				</script>
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
						session.race !== null
							? `${session.race?.id} @ ${
									session.race?.track?.name ?? "None"
							  }`
							: "None",
					status: session.status,
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
