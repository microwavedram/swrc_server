import json


TEAMS = {
    "Terraformer9": "Interios-Lotus",
    "ikonos33": "Team Fempire",
    "duxq": "Viridian Voltage",
    "Miesneus": "Valerrari FAT",
    "Aspiry": "Aspriy",
    "biloblue": "Valerrari FAT",
    "chocolatemine7": "Viridian Voltage",
    "Samuelle1411": "Interios-Lotus",
    "TheAlphaGamer787": "Interios-Lotus",
    "Malji": "New Corry Squatters",
    "aChaoticGod": "Valerrari FAT",
    "MarsCitadel": "Viridian Voltage",
    "Subayadamm": "Berin'ev Chorin",
    "GiftedTuba": "Horizon-Drunk Drivers",
    "_AmazingAstro": "New Corry Squatters",
    "Wubann": "Horizon-Drunk Drivers",
    "DJBLOCKM0NSTER": "Horizon-Drunk Drivers",
    "Alger1no": "Berin'ev Chorin",
    "s0ckks": "Carota Carrot Eaters",
    "Saiyuuuu": "Ashkavari Ocelots",
    "KandaWel": "Bumpers United",
    "Twerkish": "Bumpers United",
    "Devaliant_": "Team Fempire",
    "Loganbestone": "Berin'ev Chorin",
    "Infonix": "Bumpers United",
    "PossumRow": "Carota Carrot Eaters",
    "GiftedTuba": "Carota Carrot Eaters",
    "T1AL_": "Team Fempire"
}

SPRINTS = {
    "Libraring Sprint": "Libraring",
    "Circuit of Queens Sprint": "Circuit of Queens",
    "Mt Brimstone Sprint": "Mt Brimstone"
}

# S3 curve
# POINTS = {
#     1: 30,
#     2: 24,
#     3: 20,
#     4: 17,
#     5: 14,
#     6: 12,
#     7: 10,
#     8: 8,
#     9: 7,
#     10: 6,
#     11: 5,
#     12: 4,
#     13: 3,
#     14: 2,
#     15: 1
# }

# peak
POINTS = { x:30-x for x in range(0, 30) }
# POINTS = { x:(30-x)/30 for x in range(0, 30) }
# POINTS = { x:x for x in range(0, 100) }

for a, b in POINTS.items():
    print(a, b)

# POINTS = {
#     1: 50,
#     2: 49,
#     3: 48,
#     4: 47,
#     5: 46,
#     6: 45,
#     7: 43,
#     8: 41,
#     9: 39,
#     10: 37,
#     11: 35,
#     12: 33,
#     13: 29,
#     14: 25,
#     15: 20,
#     16: 14,
#     17: 8,
#     18: 1
# }

# POINTS = {
#     1: 30,
#     2: 29,
#     3: 28,
#     4: 27,
#     5: 26,
#     6: 25,
#     7: 24,
#     8: 22,
#     9: 21,
#     10: 19,
#     11: 17,
#     12: 15,
#     13: 12,
#     14: 10,
#     15: 7,
#     16: 5,
#     17: 2
# }

SPRINT_POINTS = {
    1: 10,
    2: 9,
    3: 8,
    4: 7,
    5: 6,
    6: 5,
    7: 4,
    8: 3,
    9: 2,
    10: 1,
}

# SPRINT_POINTS = {
#     1: 8,
#     2: 7,
#     3: 6,
#     4: 5,
#     5: 4,
#     6: 3,
#     7: 2,
#     8: 1,
# }

with open("race.season", "r") as fh:
    lines = fh.read().split("\n")

    teams = set(TEAMS.values())

    sprint_additional_points = {}
    race_additional_points = {}

    sprints = {}
    races = {}
    race = []

    race_name = ""

    for line in lines:
        if len(line) == 0: continue

        if line[0] == ">":
            if len(race) != 0:
                if race_name in SPRINTS:
                    sprints[SPRINTS[race_name]] = race.copy()
                else:
                    races[race_name] = race.copy()

                race = []

            race_name = line[2:]
            continue

        split = line.split("+")

        if len(split) > 1:
            if race_name in SPRINTS:
                specific_race = sprint_additional_points.get(race_name, {})
            else:
                specific_race = race_additional_points.get(race_name, {})
            
            specific_race[split[0]] = int(split[1])

            if race_name in SPRINTS:
                sprint_additional_points[race_name] = specific_race
            else:
                race_additional_points[race_name] = specific_race

        race.append(split[0])
        
    if race_name in SPRINTS:
        sprints[SPRINTS[race_name]] = race.copy()
    else:
        races[race_name] = race.copy()

    racers = set()

    for _, arr in races.items():
        for racer in arr:
            racers.add(racer)

    racer_positions = {}

    for racer in racers:
        racer_positions[racer] = []


    ind_map = {}
    for name, arr in races.items():
        positions = {}
        for pos, player in enumerate(arr):
            positions[player] = pos + 1

        for racer in racers:
            racer_positions[racer].append(POINTS.get(positions.get(racer, -1), 0))
            ind_map[name] = len(racer_positions[racer]) - 1

    for name, arr in sprints.items():
        positions = {}
        for pos, player in enumerate(arr):
            positions[player] = pos + 1

        for racer in racers:
            racer_positions[racer][ind_map[name]] += SPRINT_POINTS.get(positions.get(racer, -1), 0)

    racer_points = []

    for player, points in racer_positions.items():

        suplimentary = [x.get(player, 0) for x in race_additional_points.values()]
        suplimentary2 = [x.get(player, 0) for x in sprint_additional_points.values()]

        for i, v in enumerate(points):
            points[i] = v + suplimentary[i]

        points.remove(min(points))
        points.remove(min(points))

        racer_points.append({
            "name": player,
            "points": sum(points) + sum(suplimentary2)
        })


    teams = {}

    for racer_finish in sorted(racer_points, key=lambda x: x["points"], reverse=True):
        name = racer_finish["name"]
        points = racer_finish["points"]
        print(f"{name} {points}")

        team = teams.get(TEAMS.get(name, name), 0)

        team += points

        teams[TEAMS.get(name, name)] = team

    team_finish = []

    print(" - DRIVERS -")
    for name, points in teams.items():
        team_finish.append({
            "name": name,
            "points": points
        })

    print("- TEAMS -")
    for team in sorted(team_finish, key=lambda x: x["points"], reverse=True):
        name = team["name"]
        points = team["points"]
        print(f"{name} {points}")


    

