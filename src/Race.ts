import log from "npmlog"
import config from "../config.toml"

import { createWriteStream, WriteStream } from "fs"

import type { PushTrackPacket, RCEndpoint, Track } from "./services/RC"
import type { Session, SWRC } from "."
import type { AuthWebsocket } from "./util/Websocket"
import { Packets } from "./Protocol"

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
	flap: null | Flap = null

	constructor(name: string) {
		this.name = name
	}
}

export const enum Contribution {
	NONE = "NONE",
	OBSERVING = "OBSERVING",
	OBSERVING_FULL = "OBSERVING_FULL",
	PROVIDING = "PROVIDING",
	PROVIDING_TRUSTED = "PROVIDING_TRUSTED",
}

export const enum RaceState {
	NONE = "NONE",
	QUALI = "QUALI",
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
	checkpoints: { [id: number]: number }
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
	lap_delta: number
}
export interface SpeedTrapResult {
	player: string
	enter: SnapshotTime
	exit: SnapshotTime
}

export class Race {
	session: Session

	id: string
	track: Track

	racers: Racer[] = []

	state: RaceState = RaceState.NONE

	flap_stack: Flap[] = []

	contributers: { [name: string]: Contribution } = {}

	race_leaderboard: RaceLeaderboardObject[] = []
	lap_begin_times: PlayerSplit[] = []
	timer_start: number = -1
	timer_duration: number = -1

	total_laps: number
	total_pits: number

	_raceStream: WriteStream

	constructor(session: Session, raceData: PushTrackPacket) {
		this.session = session
		this.id = raceData.race_id
		this.track = raceData.track
		this.total_laps = raceData.total_laps
		this.total_pits = raceData.total_pits

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

		this.session.racer_endpoint.sendAllPacket(Packets.RACESTATE, {
			state: this.state,
		})
	}

	handleFlap(flap: Flap) {
		log.info(
			"RACE",
			`${flap.player_name} just aquired a new fastest lap ${flap.time} on lap ${flap.lap}`
		)
		this.flap_stack.push(flap)

		const racer = this.getRacerByName(flap.player_name)

		if (racer) {
			racer.flap = flap
		}
	}

	handleLap(racer: Racer, timestamp: number, lap: number, lap_time: number) {
		log.info(
			"RACE",
			`${racer.name} finished lap ${lap} with a time of ${
				lap_time / 1000
			}`
		)

		this._raceStream.write(
			`${Date.now()} META LAPTIME ${racer.name} ${lap_time}\n`
		)

		const checkpoints: { [id: number]: number } = {}

		let i = racer.splits.length - 1
		while (i >= 0) {
			const split = racer.splits[i]

			if (
				!(
					split.checkpoint_index % this.track.checkpoints.length in
					checkpoints
				)
			) {
				checkpoints[
					split.checkpoint_index % this.track.checkpoints.length
				] = split.timestamp
			}

			if (split.checkpoint_index % this.track.checkpoints.length == 0) {
				break
			}

			i--
		}

		if (this.getFlap(racer) == -1 || this.getFlap(racer) > lap_time) {
			racer.flap = {
				player_name: racer.name,
				lap: lap,
				time: lap_time,
				acquired: timestamp,
				checkpoints: checkpoints,
			}
		}
		if (
			this.flap_stack.length == 0 ||
			lap_time < this.flap_stack[this.flap_stack.length - 1].time
		) {
			this.handleFlap({
				player_name: racer.name,
				lap: lap,
				time: lap_time,
				acquired: timestamp,
				checkpoints: checkpoints,
			})
		}

		let delta = 0

		if (this.getFlap(racer) != -1) {
			delta = lap_time - this.getFlap(racer)
		}

		this.session.racer_endpoint.clients.forEach((client) => {
			if ((client as AuthWebsocket).handshake?.username == racer.name) {
				let prefix = "§e="

				if (delta > 0) prefix = "§c+"
				if (delta < 0) prefix = "§a"

				this.session.racer_endpoint.sendPacket(
					client as AuthWebsocket,
					Packets.MESSAGE,
					{
						message: `§6You§r have completed a lap in §6${
							lap_time / 1000
						} ${prefix}${delta / 1000}`,
					}
				)
			}
		})

		this.session.rc_endpoint.clients.forEach((client) => {
			let prefix = "§e="

			if (delta > 0) prefix = "§c+"
			if (delta < 0) prefix = "§a"

			this.session.racer_endpoint.sendPacket(
				client as AuthWebsocket,
				Packets.MESSAGE,
				{
					message: `§6${racer.name}§r has completed a lap in §2${
						lap_time / 1000
					} ${prefix}${delta / 1000}`,
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

		this._raceStream.write(
			`${timestamp} CHECKPOINT ${checkpoint_index} ${racer_name}\n`
		)

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

			if (racer.lap > this.total_laps && this.state == RaceState.RACE)
				return

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
			if (racer.splits.length == 0) return

			if (racer.lap > this.total_laps && this.state == RaceState.RACE)
				return
			if (racer.pit >= this.total_pits && this.state == RaceState.RACE)
				return

			racer.pit += 1
			racer.pit_splits.push({ checkpoint_index: 0, timestamp })

			this._raceStream.write(`${timestamp} PIT ${racer.name}\n`)

			this.session.racer_endpoint.clients.forEach((client) => {
				this.session.racer_endpoint.sendPacket(
					client as AuthWebsocket,
					Packets.MESSAGE,
					{
						message: `${racer.name} has completed pit ${racer.pit}`,
					}
				)
			})
		}

		this.race_leaderboard = this.rebuildLeaderboard()
	}

	handlePitEnter(racer_name: string, timestamp: number) {
		const racer = this.getRacerByName(racer_name)

		if (racer) {
			if (racer.lap >= this.total_laps && this.state == RaceState.RACE)
				return
			if (racer.pit >= this.total_pits && this.state == RaceState.RACE)
				return

			racer.pit_splits.push({ checkpoint_index: 1, timestamp })

			this._raceStream.write(`${timestamp} PIT_ENTER ${racer.name}\n`)

			this.session.racer_endpoint.clients.forEach((client) => {
				this.session.racer_endpoint.sendPacket(
					client as AuthWebsocket,
					Packets.MESSAGE,
					{
						message: `${racer.name} has entered the pit lane`,
					}
				)
			})
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

		if (this.state == RaceState.QUALI) {
			if (this.racers.length == 0) return []
			
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

			flaps.sort((a, b) => {
				if (a.time === b.time) return 0

				if (a.time === -1) return 1
				if (b.time === -1) return -1

				return a.time - b.time
			})

			const first_place_flap = flaps[0].time

			flaps.forEach((flap) => {
				let lap_delta = 0

				const latest_flap = flap.racer.flap

				if (latest_flap != null) {
					const latest_split =
						flap.racer.splits[flap.racer.splits.length - 1]

					const lap_checkpoints: { [id: number]: number } = {}

					let current_lap_begin_timestamp = 0

					let i = flap.racer.splits.length - 1
					while (i >= 0) {
						const split = flap.racer.splits[i]

						if (
							!(
								split.checkpoint_index %
									this.track.checkpoints.length in
								lap_checkpoints
							)
						) {
							lap_checkpoints[
								split.checkpoint_index %
									this.track.checkpoints.length
							] = split.timestamp
						}

						if (
							split.checkpoint_index %
								this.track.checkpoints.length ==
							0
						) {
							current_lap_begin_timestamp = split.timestamp
							break
						}

						i--
					}

					const latest_checkpoint =
						latest_split.checkpoint_index %
						this.track.checkpoints.length

					for (let i = latest_checkpoint; i >= 0; i--) {
						if (
							i in lap_checkpoints &&
							i in latest_flap.checkpoints
						) {
							const lap_time =
								lap_checkpoints[i] - current_lap_begin_timestamp
							const flap_time =
								latest_flap.checkpoints[i] -
								latest_flap.checkpoints[0]

							lap_delta = lap_time - flap_time
							break
						}
					}
				}

				leaderboard.push({
					player_name: flap.racer.name,
					time_delta: first_place_flap - flap.time,
					in_pit: false,
					flap: flap.time,
					lap_delta: lap_delta,
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
								lap_delta: 0,
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
								lap_delta: 0,
							})
						})
					}
				})
			})
		}

		return leaderboard
	}

	update() {
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
		const lap_map: { [name: string]: number } = {}

		this.racers.forEach((racer) => {
			pit_map[racer.name] = racer.pit
			lap_map[racer.name] = racer.lap
		})

		const racer_clients: {
			[username: string]: {
				version: string
				clock_precise: boolean
				clock_precision: number
			}
		} = {}

		const rc_clients: {
			[username: string]: {
				version: string
				tracking: boolean
				clock_precise: boolean
				clock_precision: number
			}
		} = {}

		this.session.rc_endpoint.clients.forEach((client) => {
			const aws: AuthWebsocket = client as AuthWebsocket

			if (aws.rc$authenticated) {
				if (aws.handshake) {
					rc_clients[aws.handshake.username] = {
						tracking: aws.rc$authorized_checkpoints,
						version: aws.handshake.version,
						clock_precise: aws.rc$clock_precise,
						clock_precision: aws.rc$clock_precision,
					}
				}
			}
		})

		this.session.racer_endpoint.clients.forEach((client) => {
			const aws: AuthWebsocket = client as AuthWebsocket

			if (aws.racer$authenticated) {
				if (aws.handshake) {
					racer_clients[aws.handshake.username] = {
						version: aws.handshake.version,
						clock_precise: aws.rc$clock_precise,
						clock_precision: aws.rc$clock_precision,
					}
				}
			}
		})

		this.session.racer_endpoint.clients.forEach((client) => {
			this.session.racer_endpoint.sendPacket(
				client as AuthWebsocket,
				Packets.UPDATE,
				{
					racers: this.racers.map((racer) => racer.name),
					race_lap_begin: this.lap_begin_times,
					race_leaderboard: this.race_leaderboard,
					racer_pits: pit_map,
					racer_laps: lap_map,
					racer_contribution: this.contributers,
					flap: this.flap_stack[this.flap_stack.length - 1],
					timer_start: this.timer_start,
					timer_duration: this.timer_duration,
					rc_clients: rc_clients,
					racer_clients: racer_clients,
				}
			)
		})
	}

	export() {}

	addPlayer(player_name: string) {
		if (this.getRacerByName(player_name)) return

		this.racers.push(new Racer(player_name))

		this.race_leaderboard = this.rebuildLeaderboard()

		this._raceStream.write(`${Date.now()} PLAYER ADD ${player_name}\n`)
	}

	removePlayer(player_name: string) {
		if (!this.getRacerByName(player_name)) return

		this.racers = this.racers.filter((racer) => racer.name != player_name)

		this.race_leaderboard = this.rebuildLeaderboard()

		this._raceStream.write(`${Date.now()} PLAYER REMOVE ${player_name}\n`)
	}
}
