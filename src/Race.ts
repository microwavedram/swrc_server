import log from "npmlog"
import config from "../config.toml"

import { createWriteStream, WriteStream } from "fs"

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
	pit_splits: Split[] = []
	splits: Split[] = []
	traps: SpeedTrapResult[] = []

	constructor(name: string) {
		this.name = name
	}
}

export const enum RaceState {
	NONE = "NONE",
	QUAL = "QUALI",
	RACE = "RACE",
}

export interface PlayerSplit {
	player_name: string
	timestamp: number
}

export interface Flap {
	player_name: string
	lap: number
	time: number
	acquired: number
}

export interface SnapshotTime {
	position: number[]
	velocity: number[]
	player: string
	timestamp: number
}

export interface RaceLeaderboardObject {
	player_name: string
	time_delta: number
	in_pit: boolean
	flap: number
}
export interface SpeedTrapResult {
	player: string
	enter: SnapshotTime
	exit: SnapshotTime
}

export class Race {
	swrc: SWRC

	id: string
	track: Track

	racers: Racer[] = []

	state: RaceState = RaceState.NONE

	flap_stack: Flap[] = []

	race_leaderboard: RaceLeaderboardObject[] = []
	lap_begin_times: PlayerSplit[] = []
	timer_start: number = -1
	timer_duration: number = -1

	_raceStream: WriteStream

	constructor(swrc: SWRC, raceData: PushTrackPacket) {
		this.swrc = swrc
		this.id = raceData.race_id
		this.track = raceData.track

		this._raceStream = createWriteStream(`./races/${this.id}.race`)
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

	handleFlap(flap: Flap) {
		log.info(
			"RACE",
			`${flap.player_name} just aquired a new fastest lap ${flap.time} on lap ${flap.lap}`
		)
		this.flap_stack.push(flap)
	}

	handleLap(racer: Racer, timestamp: number, lap: number, lap_time: number) {
		log.info(
			"RACE",
			`${racer.name} finished lap ${lap} with a time of ${
				lap_time / 1000
			}`
		)

		if (
			this.flap_stack.length == 0 ||
			lap_time < this.flap_stack[this.flap_stack.length - 1].time
		) {
			this.handleFlap({
				player_name: racer.name,
				lap: lap,
				time: lap_time,
				acquired: timestamp,
			})
		}

		let delta = 0

		if (this.getFlap(racer) != -1) {
			delta = lap_time - this.getFlap(racer)
		}
		const racerEndpoint = this.swrc.wsInterface.getPath(
			"/racer"
		) as RacerEndpoint

		if (racerEndpoint) {
			racerEndpoint.clients.forEach((client) => {
				if (
					(client as AuthWebsocket).handshake?.username == racer.name
				) {
					racerEndpoint.sendPacket(
						client as AuthWebsocket,
						RacerPacket.MESSAGE,
						{
							message: `You have completed a lap in §2${
								lap_time / 1000
							} ${delta / 1000}`,
						}
					)
				}
			})
		}

		const rcEndpoint = this.swrc.wsInterface.getPath(
			"/racecontrol"
		) as RCEndpoint

		if (rcEndpoint) {
			rcEndpoint.clients.forEach((client) => {
				racerEndpoint.sendPacket(
					client as AuthWebsocket,
					RacerPacket.MESSAGE,
					{
						message: `${racer.name} have completed a lap in §2${
							lap_time / 1000
						} ${delta / 1000}`,
					}
				)
			})
		}
	}

	handleLineCross(
		racer_name: string,
		timestamp: number,
		checkpoint_index: number
	) {
		const racer = this.getRacerByName(racer_name)

		this._raceStream.write(`${timestamp} ${racer_name} ${checkpoint_index}`)

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
				let last_lap = null

				for (let i = 0; i < racer.splits.length; i++) {
					if (
						racer.splits[i].checkpoint_index %
							this.track.checkpoints.length ==
						0
					) {
						last_lap = racer.splits[i]
					}
				}

				let lap_time = -1

				if (last_lap != null) {
					lap_time = timestamp - last_lap.timestamp
					this.handleLap(racer, timestamp, racer.lap, lap_time)
				} else if (racer.lap != 0) {
					log.warn(
						"RACE",
						`${racer_name} has no previous lap on lap ${racer.lap}`
					)
				}

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

	handlePitCross(racer_name: string, timestamp: number) {
		const racer = this.getRacerByName(racer_name)

		if (racer) {
			racer.pit += 1
			racer.pit_splits.push({ checkpoint_index: 0, timestamp })

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

		this.race_leaderboard = this.rebuildLeaderboard()
	}

	handlePitEnter(racer_name: string, timestamp: number) {
		const racer = this.getRacerByName(racer_name)

		if (racer) {
			racer.pit_splits.push({ checkpoint_index: 1, timestamp })

			const racerEndpoint = this.swrc.wsInterface.getPath(
				"/racer"
			) as RacerEndpoint

			if (racerEndpoint) {
				racerEndpoint.clients.forEach((client) => {
					racerEndpoint.sendPacket(
						client as AuthWebsocket,
						RacerPacket.MESSAGE,
						{
							message: `${racer.name} has entered the pit lane`,
						}
					)
				})
			}
		}

		this.race_leaderboard = this.rebuildLeaderboard()
	}

	getFlap(player: Racer) {
		let flap = -1
		let last = 0

		if (!this.track) return -1
		if (!this.track.checkpoints) return -1

		player.splits
			.filter(
				(split) =>
					split.checkpoint_index % this.track.checkpoints.length == 0
			)
			.forEach((split) => {
				if (last == 0) {
					last = split.timestamp
					return
				}
				if (flap == -1) {
					flap = split.timestamp - last
				}

				flap = Math.min(flap, split.timestamp - last)
				last = split.timestamp
			})

		return flap
	}

	rebuildLeaderboard(): RaceLeaderboardObject[] {
		let leaderboard: RaceLeaderboardObject[] = []

		if (this.state == RaceState.QUAL) {
			let flaps: {
				racer: Racer
				time: number
			}[] = []

			this.racers.forEach((racer) => {
				flaps.push({
					racer: racer,
					time: this.getFlap(racer),
				})
			})

			flaps.sort((a, b) => a.time - b.time)

			const first_place_flap = flaps[0].time

			flaps.forEach((flap) => {
				leaderboard.push({
					player_name: flap.racer.name,
					time_delta: first_place_flap - flap.time,
					in_pit: false,
					flap: flap.time,
				})
			})
		} else {
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
						checkpoint.checkpoint_id ==
						lastest_split.checkpoint_index
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
				lap.checkpoints.sort(
					(a, b) => b.checkpoint_id - a.checkpoint_id
				)
				lap.checkpoints.forEach((checkpoint) => {
					checkpoint.splits.sort((a, b) => a.timestamp - b.timestamp)
				})
			})
			const first_place_racer = tree[0]?.checkpoints[0]?.splits[0]?.name

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
							const player = this.getRacerByName(split.name)

							let in_pit = false
							let flap = -1
							if (player) {
								flap = this.getFlap(player)
								if (player.pit_splits.length != 0) {
									in_pit =
										player.pit_splits[
											player.pit_splits.length - 1
										].checkpoint_index != 0
								}
							}

							leaderboard.push({
								player_name: split.name,
								time_delta:
									first_place_split.timestamp -
									split.timestamp,
								in_pit,
								flap,
							})
						})
					} else {
						if (checkpoint.splits.length > 0) {
							if (checkpoint.checkpoint_id != -1) {
								log.warn(
									"RACE",
									`First place missing split ${checkpoint.checkpoint_id}`
								)
							}
						}

						checkpoint.splits.forEach((split) => {
							const player = this.getRacerByName(split.name)

							let in_pit = false
							let flap = -1
							if (player) {
								flap = this.getFlap(player)
								if (player.pit_splits.length != 0) {
									in_pit =
										player.pit_splits[
											player.pit_splits.length - 1
										].checkpoint_index == 1
								}
							}

							leaderboard.push({
								player_name: split.name,
								time_delta: 0,
								in_pit,
								flap,
							})
						})
					}
				})
			})
		}

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
						timestamp: element.timestamp,
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
					flap: this.flap_stack[this.flap_stack.length - 1],
					timer_start: this.timer_start,
					timer_duration: this.timer_duration,
				}
			)
		})
	}

	export() {}

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
