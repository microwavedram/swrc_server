import log from "npmlog"
import { WebSocketServer, type RawData } from "ws"
import { IncomingMessage } from "http"
import { AuthWebsocked as AuthWebsocket } from "./Websocket"
import type { SWRC } from ".."

export abstract class WebsocketEndpoint<Protocol> extends WebSocketServer {
	swrc: SWRC

	constructor(swrc: SWRC) {
		super({
			noServer: true,
		})

		this.swrc = swrc
	}

	async auth(request: IncomingMessage): Promise<boolean> {
		return false
	}

	onMessage(client: WebSocket, packetType: Protocol, data: Buffer): void {}
	onConnection(client: WebSocket): void {}

	async sendPacket(
		client: WebSocket,
		packetType: Protocol,
		data: any
	): Promise<void> {
		const payload = Buffer.from(await JSON.stringify(data))

		const packet = Buffer.alloc(payload.length + 1)

		payload.copy(packet, 1)
		packet.writeUInt8(packetType as number, 0)

		client.send(packet.toString())
	}

	#onConnection(
		connection: AuthWebsocket,
		message: IncomingMessage,
		pathname: string
	): void {
		log.verbose(
			"WSE",
			`Established ${message.socket.remoteAddress} on ${pathname}`
		)

		connection.on("message", (message: RawData) => {
			const buffer = Buffer.from(message.toString())

			const packetId: Protocol = buffer.at(0) as Protocol
			const data = buffer.subarray(1)

			if (packetId == undefined) {
				return
			}

			this.onMessage(connection, packetId, data)
		})

		this.onConnection(connection)
	}

	init(): void {
		this.on("connection", this.#onConnection)
	}
}
