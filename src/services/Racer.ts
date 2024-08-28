import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import { APIScope } from "../util/KeyManager"

import log from "npmlog"
import type { AuthWebsocket } from "../util/Websocket"

export const enum RacerPacket {
	HELLO = 0x00,
	HANDSHAKE = 0x01,
	NEWRACE = 0x04,
	UPDATE = 0x05,
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

				break
			default:
				log.warn("RACER", `Unknown packetId ${packetType}`)
				break
		}
	}
}
