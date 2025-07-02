import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import { Key, KeyScope, PROTO } from "../util/Key"

import log from "npmlog"
import type { AuthWebsocket } from "../util/Websocket"
import { semverToInt } from "../util/Ver"
import { SWRC, Session } from ".."
import config from "../../config.toml"
import { PROTOCOL, Packets } from "../Protocol"
import { randomBytes } from "crypto"

export interface CreateNewSessionPacket {
	key: string
}

export interface NewSessionPacket {
	id: string
	race_key: string
}

export interface DestroySessionPacket {
	session: string
	key: string
}

export class SWRCEndpoint extends WebsocketEndpoint<Packets> {
	swrc: SWRC

	constructor(swrc: SWRC) {
		super()

		this.swrc = swrc
	}

	async validToken(key_string: string): Promise<boolean> {
		const key = Key.parseKey(key_string)

		if (key.isErr()) return false

		const validKey = (
			await this.swrc.sqlite.validateKey(key.value)
		).unwrapOr(false)

		if (!validKey) return false

		return key.value.scopes.has(KeyScope.SESSION)
	}

	async auth(request: IncomingMessage): Promise<boolean> {
		return true
	}

	onConnection(client: AuthWebsocket): void {
		this.sendPacket(client, Packets.HELLO, {
			server_label: config.server_label,
		})
	}

	async onMessage(
		client: AuthWebsocket,
		packetType: Packets,
		data: Buffer
	): Promise<void> {
		if (!client.swrc$authenticated && packetType != Packets.HANDSHAKE)
			return

		switch (packetType) {
			case Packets.HANDSHAKE:
				let { username, uuid, version } = JSON.parse(data.toString())

				if (!username || !uuid || !version) {
					return
				}

				if (semverToInt(version) < PROTOCOL) {
					log.warn(
						"SERVER",
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

				client.swrc$authenticated = true

				this.sendPacket(client, Packets.HANDSHAKE, {
					motd: config.motd.swrc,
				})

				log.info(
					"SERVER",
					`${username} connected on ${version} ${semverToInt(
						version
					)}`
				)

				break
			case Packets.CREATENEWSESSION:
				let packet = JSON.parse(
					data.toString()
				) as CreateNewSessionPacket

				if (!this.validToken(packet.key)) return

				const key = Key.parseKey(packet.key)
				if (key.isErr()) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Invalid key`,
					})
					return
				}

				const valid = await this.swrc.sqlite.validateKey(key.value)

				if (valid.isErr() || valid.value == false) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Invalid key`,
					})
					return
				}

				if (!key.value.scopes.has(KeyScope.SESSION)) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Unauthorized`,
					})
					return
				}

				let open_sessions = Object.values(this.swrc.sessions).filter(
					(session) => session.owning_key.equals(key.value)
				).length

				if (
					open_sessions >= config.max_sessions_per &&
					!key.value.scopes.has(KeyScope.ADMINISTRATOR)
				) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `You have too many open sessions ${open_sessions} / ${config.max_sessions_per}`,
					})
					return
				}

				const organisation = await this.swrc.sqlite.getKeyOrg(key.value)

				const id = `${organisation.unwrapOr("<unknown>")}_${randomBytes(
					4
				).toString("hex")}`

				const session = new Session(this.swrc, id, key.value)

				this.swrc.sessions[id] = session

				const race_key = await this.swrc.sqlite.newKey(
					new Set([KeyScope.RC]),
					`SessionFor->${key.value.toKeyString()}`,
					organisation.unwrapOr("<unknown>")
				)

				session.key = race_key

				this.sendPacket(client, Packets.NEWSESSION, {
					id: id,
					race_key: race_key.toKeyString(),
				} as NewSessionPacket)

				break
			case Packets.ENDSESSION:
				let end_session_packet = JSON.parse(
					data.toString()
				) as DestroySessionPacket

				if (!this.validToken(end_session_packet.key)) return

				const key2 = Key.parseKey(end_session_packet.key)
				if (key2.isErr()) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Invalid key`,
					})
					return
				}

				const valid2 = await this.swrc.sqlite.validateKey(key2.value)

				if (valid2.isErr() || valid2.value == false) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Invalid key`,
					})
					return
				}

				if (!key2.value.scopes.has(KeyScope.SESSION)) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Unauthorized`,
					})
					return
				}

				const session2 = this.swrc.sessions[end_session_packet.session]

				if (
					!session2.owning_key.equals(key2.value) &&
					!key2.value.scopes.has(KeyScope.ADMINISTRATOR)
				) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Not your session`,
					})
					return
				}

				session2.endRace()
				session2.racer_endpoint.close()
				session2.rc_endpoint.close()

				delete this.swrc.sessions[end_session_packet.session]

				break
			default:
				log.warn("SERVER", `Unknown packetId ${packetType}`)
				break
		}
	}
}
