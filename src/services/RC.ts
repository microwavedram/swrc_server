import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import log from "npmlog"
import { APIScope } from "../util/KeyManager"
import type { AuthWebsocket } from "../util/Websocket"
import type { RaceState, SpeedTrapResult } from "../Race"
import { semverToInt } from "../util/Ver"
import { MIN_VER } from ".."
import config from "../../config.toml"
import { RacerPacket, type RacerEndpoint } from "./Racer"

export const enum RCPacket {
	HELLO = 0x00,
	HANDSHAKE = 0x01,
	LINECROSS = 0x02,
	PUSHTRACK = 0x03,
	MODIFYRACERS = 0x06,
	MESSAGE = 0x07,
	PITCROSS = 0x08,
	RACESTATE = 0x09,
	PITENTER = 0x10,
	ENDRACE = 0x11,
	SPEEDTRAP = 0x12,
	DEBUGEVAL = 0x13,
	TIMER = 0x14,
}

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

export class RCEndpoint extends WebsocketEndpoint<RCPacket> {
	async auth(request: IncomingMessage): Promise<boolean> {
		const { api_key } = parse(request.url as string, true).query

		if (api_key == undefined) return false

		const key_info = this.swrc.sqlite.getApiKey(api_key as string)

		if (key_info != null) {
			if (key_info.scopes.includes(APIScope.RC)) {
				return true
			}
		}

		return false
	}

	onConnection(client: AuthWebsocket): void {
		this.sendPacket(client, RCPacket.HELLO, {})
	}

	onMessage(client: AuthWebsocket, packetType: RCPacket, data: Buffer): void {
		log.verbose("RC", packetType, data.toString())

		if (!client.authenticated && packetType != RCPacket.HANDSHAKE) return

		switch (packetType) {
			case RCPacket.HANDSHAKE:
				const { username, uuid, version } = JSON.parse(data.toString())

				if (!username || !uuid || !version) {
					return
				}

				if (semverToInt(version) < MIN_VER) {
					log.warn(
						"RC",
						`Kicking ${username} due to outdated ${semverToInt(
							version
						)} < ${MIN_VER}`
					)
					this.sendPacket(client, RCPacket.MESSAGE, {
						message: `Your mod version is out of date, minimum required is ${MIN_VER}`,
					})
					client.close(3000)
					return
				}

				client.handshake = {
					username,
					uuid,
					version,
				}

				client.authenticated = true

				log.info(
					"RACER",
					`${username} connected on ${version} ${semverToInt(
						version
					)}`
				)

				this.sendPacket(client, RCPacket.HANDSHAKE, {})

				break
			case RCPacket.LINECROSS:
				const linecrosses = JSON.parse(data.toString()) as LineCrosses

				if (this.swrc.current_race) {
					for (const [checkpoint_id, players] of Object.entries(
						linecrosses.checkpoint_crosses
					)) {
						players.forEach((player) => {
							this.swrc.current_race?.handleLineCross(
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
			case RCPacket.PUSHTRACK:
				const trackPush: PushTrackPacket = JSON.parse(
					data.toString()
				) as PushTrackPacket

				if (this.swrc.current_race == null) {
					this.swrc.newRace(trackPush)
				} else {
					this.sendPacket(client, RCPacket.MESSAGE, {
						message:
							"Failed to start new race due to currently active race.",
					})
				}

				break
			case RCPacket.MODIFYRACERS:
				const modifyRacer: ModifyRacerPacket = JSON.parse(
					data.toString()
				) as ModifyRacerPacket

				if (this.swrc.current_race != null) {
					switch (modifyRacer.action) {
						case ModifyRacerPacketAction.ADD:
							this.swrc.current_race.addPlayer(
								modifyRacer.racer_name
							)
							break
						case ModifyRacerPacketAction.REMOVE:
							this.swrc.current_race.removePlayer(
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
					this.sendPacket(client, RCPacket.MESSAGE, {
						message:
							"Failed to modify racers due to no current active race",
					})
				}

				break
			case RCPacket.PITCROSS:
				const pitcrosses = JSON.parse(data.toString()) as PitCrosses

				if (this.swrc.current_race) {
					pitcrosses.pit_crosses.forEach((name) => {
						this.swrc.current_race?.handlePitCross(
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
			case RCPacket.PITENTER:
				const pitEnterCrosses = JSON.parse(
					data.toString()
				) as PitEnterCrosses

				if (this.swrc.current_race) {
					pitEnterCrosses.pit_enter_crosses.forEach((name) => {
						this.swrc.current_race?.handlePitEnter(
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
			case RCPacket.RACESTATE:
				const racestate = JSON.parse(data.toString()) as RaceStatePacket

				if (this.swrc.current_race) {
					this.swrc.current_race.setState(racestate.state)
				}

				break
			case RCPacket.ENDRACE:
				if (this.swrc.current_race) {
					this.swrc.endRace()
				}

				break
			case RCPacket.SPEEDTRAP:
				const speedTrap = JSON.parse(data.toString()) as SpeedTrapPacket

				if (this.swrc.current_race) {
					log.verbose("RC", speedTrap)
				}

				break

			case RCPacket.DEBUGEVAL:
				const debugEval = JSON.parse(data.toString()) as DebugEval

				if (client.handshake) {
					if (
						config.eval_users.includes(client.handshake.username) ||
						client.remoteAddress == "::ffff:127.0.0.1"
					) {
						const fn = new Function("swrc", debugEval.payload)

						try {
							const result = fn(this.swrc)

							this.sendPacket(client, RCPacket.MESSAGE, {
								message: JSON.stringify(result),
							})
						} catch (e) {
							log.warn("EVAL", e)

							const racerEndpoint = this.swrc.wsInterface.getPath(
								"/racer"
							) as RacerEndpoint

							if (racerEndpoint) {
								racerEndpoint.clients.forEach((c) => {
									if (
										(c as AuthWebsocket).handshake
											?.username ==
										client.handshake?.username
									) {
										racerEndpoint.sendPacket(
											client as AuthWebsocket,
											RacerPacket.MESSAGE,
											{
												message: `${e}`,
											}
										)
									}
								})
							}
						}
					} else {
						log.warn(
							"EVAL",
							`${client?.handshake?.username} failed eval auth`
						)
					}
				}

				break
			case RCPacket.TIMER:
				const timer = JSON.parse(data.toString()) as TimerPacket

				if (this.swrc.current_race) {
					this.swrc.current_race.timer_start = timer.start_time
					this.swrc.current_race.timer_duration = timer.duration
				}
				log.warn("RC", `ÆÆÆÆÆÆÆÆÆÆÆÆÆÆÆÆÆÆÆÆ`)

				break

			default:
				log.warn("RC", `Unknown packetId ${packetType}`)
				break
		}
	}
}
