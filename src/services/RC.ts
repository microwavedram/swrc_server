import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import log from "npmlog"
import { APIScope } from "../util/KeyManager"
import type { AuthWebsocket } from "../util/Websocket"

export const enum RCPacket {
	HELLO = 0x00,
	HANDSHAKE = 0x01,
	LINECROSS = 0x02,
	PUSHTRACK = 0x03,
	MODIFYRACERS = 0x06,
	MESSAGE = 0x07,
}

export const enum ModifyRacerPacketAction {
	ADD = "ADD",
	REMOVE = "REMOVE",
}

export interface LineCrosses {
	timestamp: number
	checkpoint_crosses: { [checkpoint_id: string]: string[] }
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
}

export interface RCHandshake {
	uuid: string
	username: string
	version: string
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

				client.handshake = {
					username,
					uuid,
					version,
				}

				client.authenticated = true

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
			default:
				log.warn("RC", `Unknown packetId ${packetType}`)
				break
		}
	}
}
