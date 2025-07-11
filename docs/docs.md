# SWRC Docs, EMC Edition
Any issues, contact @microwavedram
Your questions will be answered. No question is too stupid.
After all, I'm working with the dumbest Swedish man known to mankind (zeenix)
### Cool Features
- Really nice results https://microwavedram.github.io/swrc/season/event/ron2025.html (generated from .race files produced at the end of the race)
- Pit support
- Multiple checkpoints
- Actually maintained

### Headnotes:
- config is in modmenu, please install modmenu
- tracks are stored as `<track>.json` in `.minecraft/config/swrc/tracks`
- results are stored as `<result>.json` in `.minecraft/config/swrc/results`

# How to create a racetrack
Also known as, how to trackbuilder
### Creating a new track
`/swrc track_builder new <track_id>`
this will create a new track
#### Meta settings
These can be set at any time
`/swrc track_builder meta name "Track Name With Spaces"` the name shown in the leaderboard
`/swrc track_builder meta min_lap_time 30000` (30 seconds, this is not used as of 3.0.0 but will be in future)
`/swrc track_builder meta pit_counts_as_lap true/false` If your pit lane would bypass the start line, please enable this. It will make the pit line trigger a new lap.
### Checkpoints
- Checkpoints are lines that trigger certain events when crossed.
- Checkpoints will only detect players that travel through the correct direction
- Checkpoints will detect players crossing within 1 block up or down
- Checkpoints have a 10 second reset time, in which they cannot detect the same player
- See https://www.desmos.com/calculator/ab3a7fd492 for the detection region
#### How to create a checkpoint
Create a new checkpoint
- `/swrc track_builder checkpoint`
Set the left and right sides of the checkpoint
- `/swrc track_builder checkpoint left` (stand at the left)
- `/swrc track_builder checkpoint right` (stand at the right)
- ***You can repeat the commands to move the sides of the checkpoint***

*Please note that "left" means the left side of the track given you are looking down the track in the direction of racing*
*And for anchored, please consider googling `which way is left`*

Now use one of the following commands to finish the checkpoint 
- `/swrc track_builder checkpoint done` finalise a ***regular track checkpoint** (also known as a checkpoint)*
- `/swrc track_buidler checkpoint pit trigger` finalise a pit checkpoint, maximum of one pit checkpoint
- `/swrc track_buidler checkpoint pit enter` finalise a pit entrance checkpoint, again maximum of one
- `/swrc track_builder checkpoint` finalise a regular track checkpoint, **and then** create another, implemented as a quick shortcut
- the rest are used for anticheat-related checkpoints, lmk if you need these

#### The Structure of a track
The essentials:
- 1 Checkpoint (start line)
- If you need the pit functionality:
	- 1 Pit Trigger checkpoint

If you have a pit trigger checkpoint, ***you probably also want a pit enter checkpoint*** which will:
- Show `IN PIT`
- Allow pit deltas to be tracked

General Checklist:
- [ ] At least 2 checkpoints
- [ ] Pit enter checkpoint
- [ ] Pit trigger checkpoint
- [ ] You have set pit counts as lap (subject to track)
- [ ] You have set the name of the track
- [ ] You have set a suitable `min_lap_time` in ms (1000ms = 1sec)

Now save the track to a file
`/swrc track_builder save <filename>`

Optionally exit the track builder, which will also hide the track rendering
`/swrc track_builder exit`
The track will be saved to a `.json` file in `.minecraft/config/swrc/tracks/<id>.json`

# How to run a race
If this is your first time, please ask Pie about the "SWRC Key", or search the `swrc` ticket
You will need to set this in your config to be able to create a session.
### Connecting to SWRC central
`/swrc server connect "wss://swrc.cloudmc.uk/realtime/"`
You should see some confirming message
"Connected to SWRC Central"

Troubleshooting: check that https://swrc.cloudmc.uk is up
- If down: Contact @microwavedram
- If up: Try again, then Contact @microwavedram

### Creating a session and connecting
`/swrc server sessions create`
- the race key will be copied to your clipboard
- the race key is automatically inserted into your configuration
*send the key to any other racecontrollers for that specific race*

Troubleshooting: any sort of permissions issue / failed authentication check your SWRC key
#### Method #1
`/swrc server sessions <THE ID FROM EARLIER> connect`
(this field also autocompletes)
#### Method #2
`/swrc server sessions`
click the big green button, if multiple choose the one that either matches the ID or has the EMC prefix
### ***Please check that your position tracking is enabled in the modmenu configuration.***

If you plan to racecontrol but do not want to track the positions of players (due to a conflicting RC coverage)
please do not enable this. This has been dubbed "The Ithrun Situation" for when this goes wrong.

Position tracking toggle with be enforced by real code sometime in the coming future

Your chat should contain messages from both the `[RC]` and `[RACER]` Endpoints stating successful connection
Racers that install the mod to see the scoreboard should not expect to see a successful auth on the `[RC]` endpoint

Troubleshooting:
- If you are the person that created the session: ensure you have connected to the correct session
- Else: Check your `Race Key` is set in your modmenu config, and that it is correct

### Loading a race onto the session

The command to load a race is `/swrc race load <track_file> <race_id> <laps> <pits>`
- The `<track_file>` argument is the same as the name you saved the track to in track builder.
- The `<race_id>` argument should be a unique string for your specific race, e.g: `EMC_S9_R1_RACE` if you did quali, `EMC_S9_R1_Q1` `EMC_S9_R1_Q2` `EMC_S9_R1_Q3`
- `<laps>` and `<pits>` should be pretty self explanatory, for quali heats have a high lap count and 0 pits

If this step is successful, you should see the scoreboard header appear.

Troubleshooting:
 - Check the race file
 - Check the id is not already in use

### Running a race
All commands related to races are under `/swrc race`

##### Adding players:
Use the following:
- `/swrc race players add <player_name_spelt_correctly_with_capitals>`, also see the remove command which is identical.
- `/swrc race players near <range_in_blocks>` add all players that are within a range, except yourself.
- `/swrc race players boat <range_in_blocks>` add all players in boats within a range, including yourself if you do happen to be in a boat
- `/swrc race players file <results_file>`, results file should be a path to a `positions` results file. Its a JSON file containing the names in order. (`.minecraft/config/swrc/results/<results_file>.json`)

##### Starting the race:
To start a regular race, do `/swrc race state RACE` from this point in time the checkpoints will start tracking players. Generally run this ahead of the actual countdown, the race will start automatically when someone crosses the start line.

##### Quali instructions:
Set race state to `QUALI` instead, then allow the drivers to start driving

If applicable: make sure not to get afk kicked
##### Ending the race:
Set the race state to `NONE`
`/swrc race state NONE`

##### Export the results
You can save the current list of the leader board to a positions files with 
`/swrc race export positions <filename>` 

You can save an ordered list of fastest lap times and drivers.
`/swrc race export quali <filename>` 

You can export a race file that can be converted into many different formats of results
- https://microwavedram.github.io/swrc/season/event/ron2025.html 
- https://microwavedram.github.io/swrc/season/s2/d1/r9.html (please ignore the stoneworks in this chart)
###### Use `/swrc race url`
Contact me @microwavedram if you would like any, the scripts are jank enough at the moment to warrant a rewrite before I force you to suffer with them. (or make your own if you want)

##### Ending the race, the second coming:
`/swrc race exit` Will end the race and hide the scoreboard for everyone
`/swrc race quit` Will force end the race locally, hiding the scoreboard for you

If you do not need your session anymore, please destroy it
`/swrc server session <SESSION_ID> destroy`
