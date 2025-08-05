import jinja2
import json
import math
import itertools
import sys
import os.path
import random
import colorsys



race_name = "Race of Nations 2 (p31->p50) @ Libraring"
lap_total = 12
pit_total = 1

fout = "history.html"

env = jinja2.Environment(
    loader=jinja2.FileSystemLoader("templates"),
    autoescape=jinja2.select_autoescape()
)

template = env.get_template("history.html")

def round_x_to_n(x, n):
    return n * round(x / n)

def format(t):
    return '%s' % float('%.5g' % t)

def main():
    if len(sys.argv) != 2:
        print("wrong args")
        exit(1)

    events = []
    with open(f"./races/{sys.argv[1]}.race") as fh:
        lines = fh.read().split("\n")

        for line in lines:
            data = line.split(" ")

            if len(data) <= 1:
                continue

            events.append(data)


    grid = []

    max_checkpoint_index = 0
    for event in events:
        if event[1] == "CHECKPOINT":
            max_checkpoint_index = max(max_checkpoint_index, int(event[2]))
        if event[1] == "PLAYER":
            if event[2] == "ADD":
                grid.append(event[3])
            elif event[3] == "REMOVE":
                grid.remove(event[3])

    print("Max Checkpoint Index:", max_checkpoint_index)

    players = {}
    lap_data = [
        grid
    ]
    colors = {}

    for i, p in enumerate(grid):
        colors[p] = (
            [x * 255 for x in colorsys.hsv_to_rgb(random.random(), 1, 1)]
        )


    def construct_leaderboard():
        splits = {}

        for player, player_split in players.items():
            split = splits.get(player_split[1], [])

            split.append((player, player_split))

            split = sorted(split, key=lambda x: x[1][0])

            splits[player_split[1]] = split

        leaderboard = []
        for i in range(lap_total * max_checkpoint_index, -1, -1):
            for player_split in splits.get(i, []):
                leaderboard.append(player_split[0])

        return leaderboard

    for event in events:
        if event[1] != "CHECKPOINT":
            continue

        (timestamp, _, checkpoint, player) = event

        checkpoint = int(checkpoint)

        curr_split = players.get(player, (0, 0))
        curr_lap = curr_split[1] // max_checkpoint_index

        if checkpoint <= curr_split[1] % max_checkpoint_index:
            # new lap
            pass
        
        if curr_lap >= lap_total:
            continue

        players[player] = (timestamp, curr_lap * max_checkpoint_index + checkpoint)

        leaderboard = construct_leaderboard()

        if leaderboard[0] == player and len(leaderboard) == len(grid):
            lap_data.append(leaderboard)
            


        print(f"- Lap: {curr_lap} {curr_split[1] / max_checkpoint_index} {player}")

    links = []
    for i, (l0, l1) in enumerate(itertools.pairwise(lap_data)):
        for i1, name1 in enumerate(l0):
            for i2, name2 in enumerate(l1):
                if name1 == name2:
                    links.append(
                        (
                            (
                                i,
                                i1,
                                i + 1,
                                i2
                            ),
                            (
                                colors[name1][0],
                                colors[name1][1],
                                colors[name1][2]
                            )
                        )
                    )

    links = [json.dumps(x) for x in links]

    for t in lap_data:
        print(t)

    with open(fout, "w", encoding="utf-8") as fh:
        fh.write(template.render(
            lap_total = lap_total,
            lap_data = lap_data,
            race_name = race_name,
            p_total = len(grid),
            max_checkpoint = max_checkpoint_index,
            c_map = colors,
            str = str,
            links = links
        ))


if __name__ == "__main__":
    main()