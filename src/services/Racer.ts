import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import { KeyScope } from "../util/Key"

import log from "npmlog"
import type { AuthWebsocket } from "../util/Websocket"
import type { PushTrackPacket } from "./RC"
import { semverToInt } from "../util/Ver"
import { Session } from ".."
import { PROTOCOL, Packets } from "../Protocol"

import config from "../../config.toml"

export class RacerEndpoint extends WebsocketEndpoint<Packets> {
	session: Session

	constructor(session: Session) {
		super()

		this.session = session
	}

	async auth(request: IncomingMessage): Promise<boolean> {
		return true
	}

	onConnection(client: AuthWebsocket): void {
		this.sendPacket(client, Packets.HELLO, {})
	}

	onMessage(client: AuthWebsocket, packetType: Packets, data: Buffer): void {
		log.verbose("RACER", packetType, data.toString())

		if (!client.racer$authenticated && packetType != Packets.HANDSHAKE)
			return

		switch (packetType) {
			case Packets.HANDSHAKE:
				let { username, uuid, version } = JSON.parse(data.toString())

				if (!username || !uuid || !version) {
					return
				}

				if (semverToInt(version) < PROTOCOL) {
					log.warn(
						"RACER",
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

				client.racer$authenticated = true

				this.sendPacket(client, Packets.HANDSHAKE, {
					motd: config.motd.racer,
				})

				log.info(
					"RACER",
					`${username} connected on ${version} ${semverToInt(
						version
					)}`
				)

				if (this.session.race) {
					this.sendPacket(client as AuthWebsocket, Packets.NEWRACE, {
						race_id: this.session.race.id,
						track: this.session.race.track,
					} as PushTrackPacket)
				}

				break
			default:
				log.warn("RACER", `Unknown packetId ${packetType}`)
				break
		}
	}
}
