import type { Key } from "./Key"

export interface Handshake {
	uuid: string
	username: string
	version: string
}

export class AuthWebsocket extends WebSocket {
	racer$authenticated = false
	swrc$authenticated = false
	rc$authenticated = false

	handshake: Handshake | undefined
	remoteAddress: string = ""
}
