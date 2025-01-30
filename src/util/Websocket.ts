export interface Handshake {
	uuid: string
	username: string
	version: string
}

export class AuthWebsocket extends WebSocket {
	authenticated: boolean = false
	handshake: Handshake | undefined
	remoteAddress: string = ""
}
