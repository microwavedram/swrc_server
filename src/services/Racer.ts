import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import { APIScope } from "../util/KeyManager"

import log from "npmlog"
import type { AuthWebsocket } from "../util/Websocket"
import type { PushTrackPacket } from "./RC"

export const enum RacerPacket {
	HELLO = 0x00,
	HANDSHAKE = 0x01,
	NEWRACE = 0x04,
	UPDATE = 0x05,
	MESSAGE = 0x07,
	RACESTATE = 0x09,
}

export class RacerEndpoint extends WebsocketEndpoint<RacerPacket> {
	async auth(request: IncomingMessage): Promise<boolean> {
		return true
	}

	onConnection(client: AuthWebsocket): void {
		this.sendPacket(client, RacerPacket.HELLO, {})
	}

	onMessage(
		client: AuthWebsocket,
		packetType: RacerPacket,
		data: Buffer
	): void {
		log.verbose("RACER", packetType, data.toString())

		if (!client.authenticated && packetType != RacerPacket.HANDSHAKE) return

		switch (packetType) {
			case RacerPacket.HANDSHAKE:
				let { username, uuid, version } = JSON.parse(data.toString())

				if (!username || !uuid || !version) {
					return
				}

				client.handshake = {
					username,
					uuid,
					version,
				}

				client.authenticated = true

				this.sendPacket(client, RacerPacket.HANDSHAKE, {})

				log.info("RACER", `${username} connected on ${version}`)

				if (this.swrc.current_race) {
					this.sendPacket(
						client as AuthWebsocket,
						RacerPacket.NEWRACE,
						{
							race_id: this.swrc.current_race.id,
							track: this.swrc.current_race.track,
						} as PushTrackPacket
					)
				}

				break
			default:
				log.warn("RACER", `Unknown packetId ${packetType}`)
				break
		}
	}
}
