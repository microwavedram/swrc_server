import re
import json

events = []

with open("swrc.log") as f:
    for line in f.read().split("\n"):

        if "RC VERBOSE " in line and not "HEAD-TOKEN" in line and len(line) > 20 and "timestamp" in line and "checkpoint_crosses" in line:
            events.append(json.loads(line[40:]))


events = sorted(events, key=lambda key: key["timestamp"])

last_cross = {}
lap_counts = {}

flaps = {}

actual_events = []

finished = []

print("hi")

for event in events:
    if "timestamp" in event:
        if "0" in event["checkpoint_crosses"]:
            for name in event["checkpoint_crosses"]["0"]:
                if not name in last_cross:
                    last_cross[name] = 0
                if not name in lap_counts:
                    lap_counts[name] = 0

                delta = event["timestamp"] - last_cross[name]

                last_cross[name] = event["timestamp"]

                if (delta < flaps.get(name, 99999999999)):
                    flaps[name] = delta

                if lap_counts[name] == 15 and not name in finished:
                    finished.append(name)
                    print(name, flaps.get(name)/1000)
                
                if delta > 30000:
                    lap_counts[name] += 1
                    actual_events.append({"name": name, "timestamp": event["timestamp"]})


# for event in actual_events:
#     print(event)

# print(len(actual_events))

