import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import log from "npmlog"
import { Key, KeyScope } from "../util/Key"
import type { AuthWebsocket } from "../util/Websocket"
import type { RaceState, SpeedTrapResult } from "../Race"
import { semverToInt } from "../util/Ver"
import { Session } from ".."
import { PROTOCOL, Packets } from "../Protocol"
import config from "../../config.toml"

export const enum ModifyRacerPacketAction {
	ADD = "ADD",
	REMOVE = "REMOVE",
}

export interface LineCrosses {
	timestamp: number
	checkpoint_crosses: { [checkpoint_id: string]: string[] }
}

export interface RaceStatePacket {
	state: RaceState
}

export interface TimerPacket {
	start_time: number
	duration: number
}

export interface PitCrosses {
	timestamp: number
	pit_crosses: string[]
}

export interface SpeedTrapPacket {
	speedTrapResult: SpeedTrapResult
}

export interface PitEnterCrosses {
	timestamp: number
	pit_enter_crosses: string[]
}

export interface PushTrackPacket {
	race_id: string
	track: Track
	total_laps: number
	total_pits: number
}

export interface ModifyRacerPacket {
	racer_name: string
	action: ModifyRacerPacketAction
}

export interface Checkpoint {
	left: number[]
	right: number[]
}

export interface Track {
	race_id: string
	name: string
	minimumLapTime: number
	checkpoints: Checkpoint[]
	pit_enter: Checkpoint
	pit: Checkpoint
}

export interface RCHandshake {
	uuid: string
	username: string
	version: string
}

export interface DebugEval {
	payload: string
}

export class RCEndpoint extends WebsocketEndpoint<Packets> {
	session: Session

	constructor(session: Session) {
		super()

		this.session = session
	}

	async auth(request: IncomingMessage): Promise<boolean> {
		const { auth } = parse(request.url as string, true).query

		if (auth == undefined) return false

		const key = Key.parseKey(auth as string)

		if (key.isErr()) return false

		const validKey = (
			await this.session.swrc.sqlite.validateKey(key.value)
		).unwrapOr(false)

		if (!validKey) return false

		if (key.value.scopes.has(KeyScope.ADMINISTRATOR)) return true

		return (
			key.value.scopes.has(KeyScope.RC) &&
			this.session.key != null &&
			this.session.key.equals(key.value)
		)
	}

	onConnection(client: AuthWebsocket): void {
		this.sendPacket(client, Packets.HELLO, {})
	}

	onMessage(client: AuthWebsocket, packetType: Packets, data: Buffer): void {
		log.verbose("RC", packetType, data.toString())

		if (!client.rc$authenticated && packetType != Packets.HANDSHAKE) return

		switch (packetType) {
			case Packets.HANDSHAKE:
				const { username, uuid, version } = JSON.parse(data.toString())

				if (!username || !uuid || !version) {
					return
				}

				if (semverToInt(version) < PROTOCOL) {
					log.warn(
						"RC",
						`Kicking ${username} due to outdated ${semverToInt(
							version
						)} < ${PROTOCOL}`
					)
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Your mod version is out of date, minimum required is ${PROTOCOL}`,
					})
					client.close(3000)
					return
				}

				client.handshake = {
					username,
					uuid,
					version,
				}

				client.rc$authenticated = true

				log.info(
					"RC",
					`${username} connected on ${version} ${semverToInt(
						version
					)}`
				)

				this.sendPacket(client, Packets.HANDSHAKE, {
					motd: config.motd.rc,
				})

				break
			case Packets.LINECROSS:
				const linecrosses = JSON.parse(data.toString()) as LineCrosses

				if (this.session.race) {
					for (const [checkpoint_id, players] of Object.entries(
						linecrosses.checkpoint_crosses
					)) {
						players.forEach((player) => {
							this.session.race?.handleLineCross(
								player,
								linecrosses.timestamp,
								parseInt(checkpoint_id)
							)
						})
					}
				} else {
					log.warn(
						"RC",
						"Recieved Checkpoint cross without active race"
					)
				}

				break
			case Packets.PUSHTRACK:
				const trackPush: PushTrackPacket = JSON.parse(
					data.toString()
				) as PushTrackPacket

				if (this.session.swrc.isRaceIdTaken(trackPush.race_id)) {
					this.sendPacket(client, Packets.MESSAGE, {
						message:
							"Failed to start new race as the id is already taken",
					})
					return
				}

				if (this.session.race == null) {
					this.session.newRace(trackPush)
				} else {
					this.sendPacket(client, Packets.MESSAGE, {
						message:
							"Failed to start new race due to currently active race.",
					})
				}

				break
			case Packets.MODIFYRACERS:
				const modifyRacer: ModifyRacerPacket = JSON.parse(
					data.toString()
				) as ModifyRacerPacket

				if (this.session.race) {
					switch (modifyRacer.action) {
						case ModifyRacerPacketAction.ADD:
							this.session.race?.addPlayer(modifyRacer.racer_name)
							break
						case ModifyRacerPacketAction.REMOVE:
							this.session.race?.removePlayer(
								modifyRacer.racer_name
							)
							break
						default:
							log.warn(
								"RC",
								`Unknown ModifyRacerPacketAction ${modifyRacer.action}`
							)
							break
					}
				} else {
					this.sendPacket(client, Packets.MESSAGE, {
						message:
							"Failed to modify racers due to no current active race",
					})
				}

				break
			case Packets.PITCROSS:
				const pitcrosses = JSON.parse(data.toString()) as PitCrosses

				if (this.session.race) {
					pitcrosses.pit_crosses.forEach((name) => {
						this.session.race?.handlePitCross(
							name,
							pitcrosses.timestamp
						)
					})
				} else {
					log.warn(
						"RC",
						"Recieved Checkpoint cross without active race"
					)
				}

				break
			case Packets.PITENTER:
				const pitEnterCrosses = JSON.parse(
					data.toString()
				) as PitEnterCrosses

				if (this.session.race) {
					pitEnterCrosses.pit_enter_crosses.forEach((name) => {
						this.session.race?.handlePitEnter(
							name,
							pitEnterCrosses.timestamp
						)
					})
				} else {
					log.warn(
						"RC",
						"Recieved Checkpoint cross without active race"
					)
				}

				break
			case Packets.RACESTATE:
				const racestate = JSON.parse(data.toString()) as RaceStatePacket

				if (this.session.race) {
					this.session.race.setState(racestate.state)
				}

				break
			case Packets.ENDRACE:
				if (this.session.race) {
					this.session.endRace()
				}

				break
			case Packets.SPEEDTRAP:
				const speedTrap = JSON.parse(data.toString()) as SpeedTrapPacket

				if (this.session.race) {
					log.verbose("RC", speedTrap)
				}

				break

			case Packets.DEBUGEVAL:
				log.error("EVAL", "NOT IMPLEMENTED AS OF 3.0")

				break
			case Packets.TIMER:
				const timer = JSON.parse(data.toString()) as TimerPacket

				if (this.session.race) {
					this.session.race.timer_start = timer.start_time
					this.session.race.timer_duration = timer.duration
				}

				break

			default:
				log.warn("RC", `Unknown packetId ${packetType}`)
				break
		}
	}
}
