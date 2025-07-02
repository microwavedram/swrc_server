import log from "npmlog"

import { parse } from "url"
import { createServer, Server, IncomingMessage } from "http"
import type { WebsocketEndpoint } from "./WebsocketEndpoint"
import { getHeadToken } from "./HeadToken"
import type { AuthWebsocket } from "./Websocket"

interface WSIConfig {}

export class WebsocketInterface {
	private server: Server

	private paths: { [path: string]: WebsocketEndpoint<any> } = {}

	constructor(config: WSIConfig) {
		this.server = createServer()
	}

	addPath(path: string, websocketEndpoint: WebsocketEndpoint<any>) {
		this.paths[path] = websocketEndpoint

		websocketEndpoint.init()
	}

	removePath(path: string) {
		delete this.paths[path]
	}

	getPath(path: string): WebsocketEndpoint<any> | null {
		return this.paths[path]
	}

	#auth(request: IncomingMessage): boolean {
		if (!request.url) return false

		const { head } = parse(request.url, true).query

		// dont ask.
		if (
			head === getHeadToken(new Date().getDate()) ||
			head === getHeadToken(new Date().getDate() - 1) ||
			head === getHeadToken(new Date().getDate() + 1)
		) {
			return true
		}

		return false
	}

	listen(port: number) {
		this.server.on("upgrade", async (request, socket, head) => {
			const socket_error = (error: any) => log.error("WSI AUTH", error)

			socket.on("error", socket_error)

			if (!request.url) {
				socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n")
				socket.destroy()

				log.verbose("WSI", `No Request URL`)
				return
			}

			const authed = this.#auth(request)

			if (!authed) {
				socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
				socket.destroy()

				log.verbose("WSI", `Failed Authorization`)
				return
			}

			try {
				const { pathname } = new URL(request.url, "ws://undefined")

				if (pathname in this.paths) {
					const endpoint = this.paths[pathname]

					socket.removeListener("error", socket_error)

					log.verbose(
						"WSI",
						`Upgrading ${request.socket.remoteAddress} to ${pathname}`
					)

					if (!(await endpoint.auth(request))) {
						socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
						socket.destroy()

						log.verbose(
							"WSI",
							`${request.socket.remoteAddress} Failed Endpoint Authentication`
						)

						return
					}

					endpoint.handleUpgrade(
						request,
						socket,
						head,
						// @ts-ignore; this works but shitty typings
						(client: AuthWebsocket, message: IncomingMessage) => {
							client.remoteAddress =
								request.socket.remoteAddress || ""
							endpoint.emit(
								"connection",
								client,
								message,
								pathname
							)
						}
					)

					return
				}

				log.verbose("WSI", `Bad endpoint ${pathname}`)
				socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
				socket.destroy()
			} catch (e) {
				log.warn("WSI", e)
			}

			socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n")
			socket.destroy()
		})

		this.server.on("error", (error) => log.error("WSI", error))

		log.info("WSI", "Listening on " + port)
		this.server.listen(port)
	}
}
