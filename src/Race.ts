import log from "npmlog"

import type { PushTrackPacket, RCEndpoint, Track } from "./services/RC"
import type { SWRC } from "."
import { RacerEndpoint, RacerPacket } from "./services/Racer"
import type { AuthWebsocket } from "./util/Websocket"

export interface Split {
	timestamp: number
	checkpoint_index: number
}

export class Racer {
	name: string
	splits: Split[] = []

	constructor(name: string) {
		this.name = name
	}
}

export enum RaceState {
	SETUP,
	QUALIFY,
	PRE_RACE,
	RACE,
	POST_RACE,
}

export class Race {
	swrc: SWRC

	id: string
	track: Track

	racers: Racer[] = []

	state: RaceState = RaceState.SETUP

	constructor(swrc: SWRC, raceData: PushTrackPacket) {
		console.log(raceData)
		this.swrc = swrc
		this.id = raceData.race_id
		this.track = raceData.track
	}

	getRacerByName(name: string): Racer | null {
		for (let i = 0; i < this.racers.length; i++) {
			const racer = this.racers[i]

			if (racer.name == name) {
				return racer
			}
		}

		return null
	}

	handleLineCross(
		racer_name: string,
		timestamp: number,
		checkpoint_index: number
	) {
		const racer = this.getRacerByName(racer_name)

		if (racer) {
			racer.splits.push({
				timestamp: timestamp,
				checkpoint_index: checkpoint_index,
			})
		}
	}

	update() {
		const racerEndpoint = this.swrc.wsInterface.getPath(
			"/racer"
		) as RacerEndpoint

		racerEndpoint?.clients.forEach((client) => {
			racerEndpoint.sendPacket(
				client as AuthWebsocket,
				RacerPacket.UPDATE,
				{
					racers: this.racers.map((racer) => racer.name),
				}
			)
		})
	}

	addPlayer(player_name: string) {
		if (this.getRacerByName(player_name)) return

		this.racers.push(new Racer(player_name))
	}

	removePlayer(player_name: string) {
		if (!this.getRacerByName(player_name)) return

		this.racers = this.racers.filter((racer) => racer.name != player_name)
	}
}
