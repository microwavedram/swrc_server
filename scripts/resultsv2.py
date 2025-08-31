import argparse
import pathlib
import jinja2
import os

def decode_content(content):
    events = []

    for line in content.split("\n"):
        data = line.split(" ")

        if len(data) <= 1:
            continue

        if data[1] == "META":
            continue

        if not data[0].isdigit():
            print(f"⚠️ Malformed timestamp")
            continue

        data[0] = int(data[0])

        events.append(data)


    events.sort(key=lambda x: x[0])

    return events

def infer_race_data(events):

    highest_checkpoint = max(map(
        lambda event: int(event[2]),
        filter(
            lambda event: event[1] == "CHECKPOINT",
            events
        )    
    ))

    return highest_checkpoint

def render_results(events, laps, pits = 0,race_name="undefined"):

    highest_checkpoint = infer_race_data(events)
    total_checkpoints = highest_checkpoint + 1

    racer_data = {}
    last_cp0_cache = {}
    last_pit_enter_cache = {}

    laps_pitted_on = {}

    for event in events:
        timestamp = event[0]

        if event[1] == "PIT_ENTER":
            player = event[2]

            last_pit_enter_cache[player] = timestamp
        if event[1] == "PIT":
            player = event[2]
            if player in racer_data:
                lap = racer_data[player]["current_lap"]

                pit_laps = laps_pitted_on.get(player, {})

                if player in last_pit_enter_cache:
                    delta = timestamp - last_pit_enter_cache[player]

                    racer_data[player]["pits"].append({
                        "lap": lap,
                        "delta": delta
                    })

                    pit_laps[lap] = delta
                else:
                    racer_data[player]["pits"].append({
                        "lap": lap,
                        "delta": None
                    })

                    pit_laps[lap] = True

                laps_pitted_on[player] = pit_laps

        if event[1] != "CHECKPOINT": continue
        if event[2] != "0": continue

        index = int(event[2])
        player = event[3]

        data = racer_data.get(player, {
            "splits": [],
            "pits": [],
            "current_lap": 0,
        })

        checkpoint_number = (data["current_lap"] - 1) * total_checkpoints + index
        if checkpoint_number > (laps - 1) * total_checkpoints:
            print(f"⚠️  Ignoring extra checkpoint {checkpoint_number} for {player}")
            continue

        if index == 0:
            lap_time = timestamp - last_cp0_cache.get(player, 0)
            curr_lap = data["current_lap"]

            if lap_time < 10000:
                print(f"⚠️  Ignoring short lap {curr_lap} for {player}")
                continue

            last_cp0_cache[player] = timestamp

            data["current_lap"] += 1

        data["splits"].append({
            "timestamp": timestamp,
            "index": index,
        })

        racer_data[player] = data


    buckets = {}

    for player, data in racer_data.items():
        latest_split = data["splits"][-1]

        latest_checkpoint_number = total_checkpoints * (data["current_lap"] - 1) + latest_split["index"]

        bucket = buckets.get(latest_checkpoint_number, [])

        bucket.append({
            "player": player,
            "timestamp": latest_split["timestamp"]
        })

        buckets[latest_checkpoint_number] = bucket

    finishing_order = []

    for checkpoint_number in sorted(buckets.keys(), reverse=True):
        for finish in sorted(buckets[checkpoint_number], key=lambda finish: finish["timestamp"]):
            finishing_order.append(finish)

    for player, data in racer_data.items():
        pits_completed = len(data["pits"])

        if pits_completed != pits:
            print(f"⚠️  {player} has pitted the wrong number of times ({pits_completed} of {pits})")

    last_finish_timestamp = None
    finishing_gap = {}
    
    print("- Finishing Order -")
    for i, finish in enumerate(finishing_order):
        player = finish["player"]

        if racer_data[player]["current_lap"] < laps + 1:
            print(f"{i + 1} {player} DNF")
        elif last_finish_timestamp != None:
            delta = finish["timestamp"] - last_finish_timestamp

            finishing_gap[player] = delta

            print(f"{i + 1} {player} +{delta / 1000}")
        else:
            finishing_gap[player] = 0
            print(f"{i + 1} {player} -")


        last_finish_timestamp = finish["timestamp"]

    racer_lap_times = {}
    for name, data in racer_data.items():

        lap_times = []

        last = None
        for i, finish in enumerate(data["splits"]):
            if last:
                delta = finish["timestamp"] - last

                lap_times.append(delta)
            last = finish["timestamp"]

        racer_lap_times[name] = lap_times


    for lap_times in racer_lap_times.values():
        while len(lap_times) < laps:
            lap_times.append(0)
            

    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader("templates"),
        autoescape=jinja2.select_autoescape()
    )

    template = env.get_template("resultsv2.html")

    return template.render(
        finishing_order=finishing_order,
        racer_lap_times=racer_lap_times,
        racer_data=racer_data,
        finishing_gap=finishing_gap,
        laps_pitted_on=laps_pitted_on,
        laps=laps,
        enumerate=enumerate,
        race_name=race_name,
        format_time=lambda ms: (lambda m, s, f: f"{s}.{f:03}" if m == 0 else f"{m:02}:{s:02}.{f:03}")(
            ms // 60000,
            (ms % 60000) // 1000,
            int(((ms % 1000) // 50) * 50)
        ),
        min=min,
        sum=sum,
        len=len,
        int=int,
        std_dev=lambda data: (sum((x - (sum(data) / len(data)))**2 for x in data) / len(data))**0.5
    )

def main():

    parser = argparse.ArgumentParser(description="Classify items from a JSON file.")
    parser.add_argument("-i", "--input", required=True, help="Path to a .race file.")
    parser.add_argument("-o", "--output", required=True, help="Path to save the file to.")
    parser.add_argument("-f", "--format", required=True, help="Formats to export in.")
    parser.add_argument("-n", "--name", help="Race Name")
    parser.add_argument("-l", "--laps", required=True, help="Total laps", type=int)
    parser.add_argument("-p", "--pits", default=0, help="Total pits", type=int)
    parser.add_argument("--insert-pit-laps", action="store_true" , help="Insert pit counts as lap checkpoints after the fact.")
    parser.add_argument("--insert-pit-from-enter", help="saisho please", type=int)
    parser.add_argument("--split-long-laps", default=None, help="fix missed start line checkpoints", type=int)

    args = parser.parse_args()

    race_name = pathlib.Path(args.input).stem

    try:
        print(f"🔍 Reading race: {args.input}")
        with open(args.input, "r") as fh:
            events = decode_content(fh.read())
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    if args.insert_pit_from_enter:

        i = 0
        while i < len(events):
            event = events[i]

            if event[1] == "PIT_ENTER":
                player = event[2]

                events.insert(i + 1, [
                    event[0] + args.insert_pit_from_enter,
                    "PIT",
                    player
                ])

            i = i + 1

        events.sort(key=lambda x: int(x[0]))

        bad = []

        last_pit_timestamp, last_pit_player = 0, ""
        for i, event in enumerate(events):
            if event[1] == "PIT":
                if abs(event[0] - last_pit_timestamp) < 20000 and event[2] == last_pit_player:
                    bad.append(i)

                last_pit_timestamp, last_pit_player = event[0], event[2]

        for ind in reversed(bad):
            events.pop(ind)

        events.sort(key=lambda x: int(x[0]))
        
    
    if args.insert_pit_laps:
        i = 0
        while i < len(events):
            event = events[i]

            if event[1] == "PIT":
                player = event[2]

                events.insert(i + 1, [
                    event[0] + 1,
                    "CHECKPOINT",
                    "0",
                    player
                ])

            i = i + 1

    if args.split_long_laps:

        cp0_cache = {}

        i = 0
        while i < len(events):
            event = events[i]

            if event[1] == "CHECKPOINT":
                checkpoint_number = int(event[2])
                player = event[3]

                if checkpoint_number == 0:
                    if player in cp0_cache:
                        lap_time = event[0] - cp0_cache.get(player)

                        if lap_time > args.split_long_laps:
                            print(f"⚠️  {player} has long lap, splitting")
                            events.insert(i - 1, [event[0] - lap_time // 2, "CHECKPOINT", "0", player])
                            i = i + 1

                
                    cp0_cache[player] = event[0]

            i = i + 1
    
    output = ""

    if args.format == "resultsv2":
        output = render_results(events, laps=args.laps, pits=args.pits, race_name=race_name)
    else:
        print(f"⚠️  Invalid results format")
        exit(1)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(output)

if __name__ == "__main__":
    main()