import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import { APIScope } from "../util/KeyManager"

export const enum RCPacket {
	HANDSHAKE = 0x00,
}

export class RC extends WebsocketEndpoint<RCPacket> {
	async auth(request: IncomingMessage): Promise<boolean> {
		const { api_key } = parse(request.url as string, true).query

		if (api_key == undefined) return false

		const key_info = this.swrc.sqlite.getApiKey(api_key as string)

		if (key_info != null) {
			if (key_info.scopes.includes(APIScope.PTR)) {
				return true
			}
		}

		return false
	}

	onConnection(client: WebSocket): void {
		this.sendPacket(client, RCPacket.HANDSHAKE, ":wave:")
	}

	onMessage(client: WebSocket, packetType: RCPacket, data: Buffer): void {
		switch (packetType) {
			case RCPacket.HANDSHAKE:
				console.log(packetType, data)
				this.sendPacket(client, RCPacket.HANDSHAKE, "hi")
		}
	}
}
