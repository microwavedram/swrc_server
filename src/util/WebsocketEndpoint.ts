import log from "npmlog"
import { WebSocketServer, type RawData } from "ws"
import { IncomingMessage } from "http"
import { AuthWebsocket } from "./Websocket"

export abstract class WebsocketEndpoint<Protocol> extends WebSocketServer {
	constructor() {
		super({
			noServer: true,
		})
	}

	async auth(request: IncomingMessage): Promise<boolean> {
		return false
	}

	onMessage(client: WebSocket, packetType: Protocol, data: Buffer): void {}
	onConnection(client: AuthWebsocket): void {}

	async sendAllPacket(packetType: Protocol, data: any) {
		this.clients.forEach((client) =>
			this.sendPacket(client as AuthWebsocket, packetType, data)
		)
	}

	async sendPacket(
		client: AuthWebsocket,
		packetType: Protocol,
		data: any
	): Promise<void> {
		const payload = Buffer.from(await JSON.stringify(data))

		const packet = Buffer.alloc(payload.length + 1)

		payload.copy(packet, 1)
		packet.writeUint8(packetType as number, 0)

		client.send(packet)
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
			const buffer = Buffer.from(message.toString("utf8"))

			const packetId: Protocol = buffer.at(1) as Protocol
			const data = buffer.subarray(2)

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
