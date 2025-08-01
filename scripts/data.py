import jinja2
import json
import math
import sys
import os.path

race_name = "Race of Nations 2 d2 @ Libraring"
lap_total = 12
pit_total = 1

fout = "index.html"

known_fucky_shit = [
]

env = jinja2.Environment(
    loader=jinja2.FileSystemLoader("templates"),
    autoescape=jinja2.select_autoescape()
)

template = env.get_template("index.html")

def round_x_to_n(x, n):
    return n * round(x / n)

def format(t):
    return '%s' % float('%.5g' % t)

def calculate_std_dev(numbers):
    if len(numbers) == 0:
        return 0
    
    mean = sum(numbers) / len(numbers)
    
    squared_diff = [(x - mean) ** 2 for x in numbers]
    
    variance = sum(squared_diff) / len(numbers)
    
    std_dev = variance ** 0.5
    
    return std_dev

def chunk_file():
    chunk = []
    chunks = []

    with open("s.log") as f:
        for line in f.read().split("\n"):

            if len(line) == 0:
                continue

            if line[0] == "[" and len(chunk) > 0:
                chunks.append(chunk.copy())
                chunk = []

            chunk.append(line)

    return chunks

def anticheat(speed_traps):

    deltas = []

    for trap in speed_traps:
        enter = trap["enter"]["timestamp"]
        exit = trap["exit"]["timestamp"]

        delta = (exit - enter) / 1000
        
        dx = trap["enter"]["position"][0] - trap["exit"]["position"][0]
        dy = trap["enter"]["position"][1] - trap["exit"]["position"][1]
        dz = trap["enter"]["position"][2] - trap["exit"]["position"][2]

        d = math.sqrt(dx*dx + dy*dy + dz*dz)

        speed = d/delta


        print(trap["player"], delta)

        deltas.append((trap["player"], delta))
        
        pass

    tt = sorted(deltas, key=lambda x: x[1])

    for x in tt:
        print(x)

def lap_data(crosses):
    players = []

    lookup = {}

    largest_checkpoint = 1
    highest_lap = 1

    crosses = sorted(crosses, key=lambda x: x["timestamp"])
    checkpoint_deltas = []
    last_split = 0
    for cross_event in crosses:
        timestamp = cross_event["timestamp"]
        for checkpoint_id, player_names in cross_event["checkpoint_crosses"].items():
            checkpoint_id = int(checkpoint_id)

            largest_checkpoint = max(largest_checkpoint, checkpoint_id)

            
            for player_name in player_names:
                if not player_name in lookup:
                    o = { "name": player_name, "splits": [], "laps": [], "pos": 0, "checkpoint_deltas": [] }
                    lookup[player_name] = o
                    players.append(o)

                player_ref = lookup.get(player_name)
                
                previous_checkpoint = -1
                if len(player_ref["splits"]) > 0:
                    previous_checkpoint = player_ref["splits"][-1]["checkpoint_id"] 

                lap = len(player_ref["laps"])
                if (checkpoint_id <= previous_checkpoint or previous_checkpoint == -1) and checkpoint_id == 0:
                    
                    last_split = timestamp
                    
                    player_ref["checkpoint_deltas"].append(checkpoint_deltas.copy())

                    checkpoint_deltas = []

                    highest_lap = max(highest_lap, lap)
                    if lap <= lap_total:
                        player_ref["laps"].append(timestamp)
                
                if checkpoint_id != 0 and previous_checkpoint + 1 != checkpoint_id:
                    if not f"{previous_checkpoint}->{checkpoint_id}" in known_fucky_shit:
                        print(f"Something fucky happend :: {player_name} {previous_checkpoint}->{checkpoint_id}")

                if lap <= lap_total:
                    if previous_checkpoint < checkpoint_id or checkpoint_id == 0:
                        player_ref["splits"].append({ "checkpoint_id": checkpoint_id, "timestamp": timestamp })
                        checkpoint_deltas.append(timestamp - last_split)
                        last_split = timestamp

    # print(highest_lap)
            

    by_checkpoint = {}

    


    for player in players:
        k = (len(player["laps"])) * largest_checkpoint + player["splits"][-1]["checkpoint_id"]

        if not k in by_checkpoint:
            by_checkpoint[k] = []

        by_checkpoint[k].append(player)
    
    for checkpoint_id, players in by_checkpoint.items():
        by_checkpoint[checkpoint_id] = sorted(players, key=lambda x: x["splits"][-1]["timestamp"])




    leaderboard = []

    kill_me = sorted(list(by_checkpoint.items()), key=lambda x:x[0], reverse=True)

    for i, x in enumerate(kill_me):
        kill_me[i] = sorted(x[1], key=lambda k: k["splits"][-1]["timestamp"])

    with open("unfuckerising.json", "w") as fh:
        fh.write(json.dumps(kill_me, indent=4))

    for checkpoint in kill_me:
        for player in checkpoint:
            # print(player["name"], player["splits"][-1]["timestamp"])
            leaderboard.append(player)
            player["pos"] = len(leaderboard)

    return leaderboard

def pit_data(pits, pit_enters):
    players = {}

    for pit_event in pits:
        timestamp = pit_event["timestamp"]
        for player in pit_event["pit_crosses"]:
            if not player in players:
                players[player] = { "pits": [], "pit_enters": [], "deltas": [] }

            players[player]["pits"].append(timestamp)

    for pit_event in pit_enters:
        timestamp = pit_event["timestamp"]
        for player in pit_event["pit_enter_crosses"]:
            if not player in players:
                players[player] = { "pits": [], "pit_enters": [], "deltas": []  }

            players[player]["pit_enters"].append(timestamp)

    for name, record in players.items():

        enters = len(record["pit_enters"])
        exits = len(record["pits"])

        if enters != exits:
            print(f"Pit Discrepency: {name} {enters} {exits}")

        for i in range(min(enters, exits)):
            record["deltas"] = record["pits"][i] - record["pit_enters"][i]
        
    return players


def findInLeaderboard(leaderboard, name):
    for leader in leaderboard:
        if leader["name"] == name:
            return leader
    return None

def main():
    chunks = chunk_file()

    speed_traps = []
    crosses = []
    pits = []
    pit_enters = []
    player_events = []

    for part in chunks:
        full = "".join(part)

        prefix = "".join(full.split("{")[0])
        part = full[len(prefix):]
        
        if "RC VERBOSE 18" in prefix:
            parsed = json.loads(part)

            speed_traps.append(parsed["speedTrapResult"])
        elif "RC VERBOSE 2" in prefix:
            parsed = json.loads(part)

            crosses.append(parsed)
        elif "RC VERBOSE 8" in prefix:
            parsed = json.loads(part)

            pits.append(parsed)
        elif "RC VERBOSE 16" in prefix:
            parsed = json.loads(part)

            pit_enters.append(parsed)
        elif "RC VERBOSE 6" in prefix:
            parsed = json.loads(part)

            player_events.append(parsed)
    
    if len(sys.argv) == 3 and sys.argv[1] == "--transform":
        if not os.path.exists("./races"):
            os.mkdir("races")
        with open(f"./races/{sys.argv[2]}.race", "w") as fh:

            lines = []

            for i, action in enumerate(player_events):
                lines.append((i, "PLAYER", action["action"], action["racer_name"]))

            for cross in crosses:
                timestamp = cross["timestamp"]
                for checkpointid, players in cross["checkpoint_crosses"].items():
                    for player in players:
                        lines.append((timestamp, "CHECKPOINT", checkpointid, player))

            for pit in pits:
                timestamp = pit["timestamp"]
                for player in pit["pit_crosses"]:
                        lines.append((timestamp, "PIT", player))

            for pit in pit_enters:
                timestamp = pit["timestamp"]
                for player in pit["pit_enter_crosses"]:
                        lines.append((timestamp, "PIT_ENTER", player))

            for pit in pit_enters:
                timestamp = pit["timestamp"]
                for player in pit["pit_enter_crosses"]:
                        lines.append((timestamp, "PIT_ENTER", player))


                        

            lines = sorted(lines, key = lambda x: x[0])

            for line in lines:
                fh.write(" ".join([str(x) for x in line]) + "\n")
                        

    anticheat(speed_traps)

    pits = pit_data(pits, pit_enters)
    leaderboard = lap_data(crosses)

    pit_laps = {}

    for player in leaderboard:
        d = {}

        if not player["name"] in pits:
            pit_laps[player["name"]] = d
            continue

        for pit_n, pit in enumerate(pits[player["name"]]["pits"]):
            i = 0
            found = True
            while player["laps"][i] < pit:
                i = i + 1

                if i == len(player["laps"]):
                    print("Failed to locate pit?")
                    found = False
                    break

            if found:
                d[i] = pit_n

        pit_laps[player["name"]] = d


                

    
    flaps = {}
    avgs = {}
    stddevs = {}

    for player in leaderboard:
        player["laps"] = [(x, []) for x in player["laps"]]

        prev = None
        flap = 88888888888888888
        for i, lap in enumerate(player["laps"]):
            if prev != None:
                delta = lap[0] - prev
                
                flap = min(flap, delta)

                player["laps"][i - 1] = (format(round_x_to_n(delta / 1000, 0.05)), [format(round_x_to_n(x, 0.05)) for x in player["checkpoint_deltas"][i]], None)
            prev = lap[0]
        
        flaps[player["name"]] =  format(round_x_to_n(flap / 1000, 0.05))
        player["laps"] = player["laps"][:-1]


        real_laps = [float(x[0]) for x in player["laps"]]
        total = sum(real_laps)

        if len(real_laps) > 0:
            avgs[player["name"]] = format(round_x_to_n((total / len(real_laps)), 0.05))
            stddevs[player["name"]] = format(round_x_to_n(calculate_std_dev(real_laps), 0.05))
        else:
            avgs[player["name"]] = "-"
            stddevs[player["name"]] = "-"

        for _ in range(lap_total - len(player["laps"])):
            player["laps"].append(("", "", None))

        for i, v in pit_laps[player["name"]].items():
            if len(player["laps"]) <= i:
                continue

            player["laps"][i - 1] = (player["laps"][i - 1][0], player["laps"][i - 1][1], -1)
            player["laps"][i] = (player["laps"][i][0], player["laps"][i][1], 1)

    # for v in leaderboard:
    #     print(v)        


    with open(fout, "w") as fh:
        fh.write(template.render(
            leaderboard = leaderboard,
            race_name = race_name,
            laps = len(leaderboard[0]["laps"]),
            flaps = flaps,
            avgs = avgs,
            stddevs = stddevs
        ))


if __name__ == "__main__":
    main()

    