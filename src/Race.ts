import log from "npmlog"
import config from "../config.toml"

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
	lap: number = 0
	pit: number = 0
	splits: Split[] = []

	constructor(name: string) {
		this.name = name
	}
}

export const enum RaceState {
	SETUP = "SETUP",
	QUALIFY = "QUALIFY",
	PRE_RACE = "PRE_RACE",
	RACE = "RACE",
	POST_RACE = "POST_RACE",
}

export interface RaceLeaderboardObject {
	player_name: string
	time_delta: number
}

export class Race {
	swrc: SWRC

	id: string
	track: Track

	racers: Racer[] = []

	state: RaceState = RaceState.SETUP

	race_leaderboard: RaceLeaderboardObject[] = []
	lap_begin_times: RaceLeaderboardObject[] = []

	constructor(swrc: SWRC, raceData: PushTrackPacket) {
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

	setState(state: RaceState) {
		this.state = state

		const racerEndpoint = this.swrc.wsInterface.getPath(
			"/racer"
		) as RacerEndpoint

		racerEndpoint?.clients.forEach((client) => {
			racerEndpoint.sendPacket(
				client as AuthWebsocket,
				RacerPacket.RACESTATE,
				{
					state: this.state,
				}
			)
		})
	}

	handleLineCross(
		racer_name: string,
		timestamp: number,
		checkpoint_index: number
	) {
		const racer = this.getRacerByName(racer_name)

		if (racer) {
			const last_split = racer.splits[racer.splits.length - 1]

			if (last_split && last_split.checkpoint_index == checkpoint_index) {
				if (
					timestamp - last_split.timestamp <
					config.checkpoint_reset_speed
				) {
					log.verbose("RACE", "dumped event")
					return
				}
			}

			if (checkpoint_index == 0) {
				racer.lap += 1
			}

			racer.splits.push({
				timestamp: timestamp,
				checkpoint_index:
					this.track.checkpoints.length * racer.lap +
					checkpoint_index,
			})
		}

		this.race_leaderboard = this.rebuildLeaderboard()
	}

	handlePitCross(race_name: string, timestamp: number) {
		const racer = this.getRacerByName(race_name)

		if (racer) {
			racer.pit += 1

			const racerEndpoint = this.swrc.wsInterface.getPath(
				"/racer"
			) as RacerEndpoint

			if (racerEndpoint) {
				racerEndpoint.clients.forEach((client) => {
					racerEndpoint.sendPacket(
						client as AuthWebsocket,
						RacerPacket.MESSAGE,
						{
							message: `${racer.name} has completed pit ${racer.pit}`,
						}
					)
				})
			}
		}
	}

	rebuildLeaderboard(): RaceLeaderboardObject[] {
		let leaderboard: RaceLeaderboardObject[] = []

		// what the fuck
		const tree: {
			lap: number
			checkpoints: {
				checkpoint_id: number
				splits: { name: string; timestamp: number }[]
			}[]
		}[] = []

		this.racers.forEach((racer) => {
			let lastest_split = racer.splits[racer.splits.length - 1]

			if (!lastest_split) {
				lastest_split = {
					timestamp: -1,
					checkpoint_index: -1,
				}
			}
			// assemble a tree

			let lap = tree.filter((lap) => lap.lap == racer.lap)[0]

			if (!lap) {
				lap = { lap: racer.lap, checkpoints: [] }
				tree.push(lap)
			}

			let checkpoint = lap.checkpoints.filter(
				(checkpoint) =>
					checkpoint.checkpoint_id == lastest_split.checkpoint_index
			)[0]

			if (!checkpoint) {
				checkpoint = {
					checkpoint_id: lastest_split.checkpoint_index,
					splits: [],
				}
				lap.checkpoints.push(checkpoint)
			}

			checkpoint.splits.push({
				name: racer.name,
				timestamp: lastest_split.timestamp,
			})
		})

		tree.sort((a, b) => b.lap - a.lap)
		tree.forEach((lap) => {
			lap.checkpoints.sort((a, b) => b.checkpoint_id - a.checkpoint_id)
			lap.checkpoints.forEach((checkpoint) => {
				checkpoint.splits.sort((a, b) => a.timestamp - b.timestamp)
			})
		})

		const first_place_racer = tree[0].checkpoints[0].splits[0].name

		tree.forEach((lap) => {
			lap.checkpoints.forEach((checkpoint) => {
				const first_place_split = this.getRacerByName(
					first_place_racer
				)?.splits.find(
					(split) =>
						split.checkpoint_index == checkpoint.checkpoint_id
				)
				if (first_place_split) {
					checkpoint.splits.forEach((split) => {
						leaderboard.push({
							player_name: split.name,
							time_delta:
								first_place_split.timestamp - split.timestamp,
						})
					})
				} else {
					if (checkpoint.splits.length > 0) {
						log.warn(
							"RACE",
							`First place missing split ${checkpoint.checkpoint_id}`
						)
					}

					checkpoint.splits.forEach((split) => {
						leaderboard.push({
							player_name: split.name,
							time_delta: 0,
						})
					})
				}
			})
		})

		return leaderboard
	}

	update() {
		const racerEndpoint = this.swrc.wsInterface.getPath(
			"/racer"
		) as RacerEndpoint

		this.lap_begin_times = []

		this.racers.forEach((racer) => {
			for (let i = racer.splits.length - 1; i >= 0; i--) {
				const element = racer.splits[i]

				if (
					element.checkpoint_index % this.track.checkpoints.length ==
					0
				) {
					this.lap_begin_times.push({
						player_name: racer.name,
						time_delta: element.timestamp,
					})

					break
				}
			}
		})

		const pit_map: { [name: string]: number } = {}
		this.racers.forEach((racer) => {
			pit_map[racer.name] = racer.pit
		})

		const lap_map: { [name: string]: number } = {}
		this.racers.forEach((racer) => {
			lap_map[racer.name] = racer.lap
		})

		racerEndpoint?.clients.forEach((client) => {
			racerEndpoint.sendPacket(
				client as AuthWebsocket,
				RacerPacket.UPDATE,
				{
					racers: this.racers.map((racer) => racer.name),
					race_lap_begin: this.lap_begin_times,
					race_leaderboard: this.race_leaderboard,
					racer_pits: pit_map,
					racer_laps: lap_map,
				}
			)
		})
	}

	addPlayer(player_name: string) {
		if (this.getRacerByName(player_name)) return

		this.racers.push(new Racer(player_name))

		this.race_leaderboard = this.rebuildLeaderboard()
	}

	removePlayer(player_name: string) {
		if (!this.getRacerByName(player_name)) return

		this.racers = this.racers.filter((racer) => racer.name != player_name)

		this.race_leaderboard = this.rebuildLeaderboard()
	}
}
