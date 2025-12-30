import type { IncomingMessage } from "http"
import { WebsocketEndpoint } from "../util/WebsocketEndpoint"
import { parse } from "url"
import { Key, KeyScope } from "../util/KeyChain"

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

export interface RenameSessionPacket {
	session: string
	key: string
	name: string
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

		const validKey = this.swrc.keychain.verifyKey(key.value)

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
					log.verbose("SWRC", "FAILED KEY DECODE " + key.error)
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Invalid key`,
					})
					return
				}

				const valid = await this.swrc.keychain.verifyKey(key.value)

				if (valid !== true) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Failed Signature`,
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

				const organisation = key.value.org

				const id = `${organisation}_${randomBytes(2).toString("hex")}`

				const session = new Session(this.swrc, id, key.value)

				this.swrc.sessions[id] = session

				const race_key = this.swrc.keychain.newKey(
					id,
					organisation,
					new Set([KeyScope.RC])
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

				const valid2 = await this.swrc.keychain.verifyKey(key2.value)

				if (valid2 !== true) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Failed Signature`,
					})
					return
				}

				if (
					!key2.value.scopes.has(KeyScope.SESSION) &&
					!key2.value.scopes.has(KeyScope.ADMINISTRATOR)
				) {
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

			case Packets.NAMESESSION:
				let name_session_packet = JSON.parse(
					data.toString()
				) as RenameSessionPacket

				if (!this.validToken(name_session_packet.key)) return

				const key3 = Key.parseKey(name_session_packet.key)
				if (key3.isErr()) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Invalid key`,
					})
					return
				}

				const valid3 = await this.swrc.keychain.verifyKey(key3.value)

				if (valid3 !== true) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Failed Signature`,
					})
					return
				}

				if (
					!key3.value.scopes.has(KeyScope.SESSION) &&
					!key3.value.scopes.has(KeyScope.ADMINISTRATOR)
				) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Unauthorized`,
					})
					return
				}

				const session3 = this.swrc.sessions[name_session_packet.session]

				if (
					!session3.owning_key.equals(key3.value) &&
					!key3.value.scopes.has(KeyScope.ADMINISTRATOR)
				) {
					this.sendPacket(client, Packets.MESSAGE, {
						message: `Not your session`,
					})
					return
				}

				session3.status = name_session_packet.name

				break
			default:
				log.warn("SERVER", `Unknown packetId ${packetType}`)
				break
		}
	}
}
