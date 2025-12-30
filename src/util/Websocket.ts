import type { Key } from "./KeyChain"

export interface Handshake {
	uuid: string
	username: string
	version: string
}

export class AuthWebsocket extends WebSocket {
	racer$authenticated = false
	swrc$authenticated = false
	rc$authenticated = false

	rc$authorized_checkpoints = false
	rc$clock_precise = false
	rc$clock_precision = 0

	handshake: Handshake | undefined
	remoteAddress: string = ""
}
